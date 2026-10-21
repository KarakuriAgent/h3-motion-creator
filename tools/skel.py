# 骨（tools/gemx2glb.py が書いた glb。SOMA の 77 本）を読む・関節の位置を出す・元の動画のカメラを求める・棒人間を描く。
# gemx2glb.py（カメラを stats.json に書く）・render_bones.py（骨の動画）が使う。GEM-X の venv の python（numpy・scipy・opencv）で動かす
import json
import struct
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation


def load_glb(path):
    """glb を読む → names, parents, offsets (J,3), hips (L,3), quats (L,J,4 xyzw), times (L,)"""
    data = Path(path).read_bytes()
    jlen, _ = struct.unpack_from('<I4s', data, 12)
    gltf = json.loads(data[20 : 20 + jlen])
    boff = 20 + jlen
    blen, _ = struct.unpack_from('<I4s', data, boff)
    binb = data[boff + 8 : boff + 8 + blen]
    nodes = gltf['nodes']
    J = len(nodes)
    names = [n['name'] for n in nodes]
    parents = [-1] * J
    for j, n in enumerate(nodes):
        for c in n.get('children', []):
            parents[c] = j
    offsets = np.array([n.get('translation', [0, 0, 0]) for n in nodes], dtype=np.float64)

    def acc(i):
        a = gltf['accessors'][i]
        v = gltf['bufferViews'][a['bufferView']]
        size = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        arr = np.frombuffer(binb, dtype=np.float32, count=a['count'] * size, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
        return arr.reshape(a['count'], size).astype(np.float64)

    anim = gltf['animations'][0]
    L = None
    hips = None
    quats = None
    times = None
    for ch in anim['channels']:
        s = anim['samplers'][ch['sampler']]
        out = acc(s['output'])
        if L is None:
            L = out.shape[0]
            quats = np.tile(np.array([0, 0, 0, 1.0]), (L, J, 1))
            times = acc(s['input'])[:, 0]
        node = ch['target']['node']
        if ch['target']['path'] == 'translation':
            hips = out
        elif ch['target']['path'] == 'rotation':
            quats[:, node] = out
    return names, parents, offsets, hips, quats, times


def fk(parents, offsets, hips, quats):
    """関節のワールドの位置 (L,J,3)"""
    L, J = quats.shape[:2]
    Rl = Rotation.from_quat(quats.reshape(-1, 4)).as_matrix().reshape(L, J, 3, 3)
    Rw = np.zeros_like(Rl)
    P = np.zeros((L, J, 3))
    for j in range(J):
        p = parents[j]
        if p < 0:
            Rw[:, j] = Rl[:, j]
            P[:, j] = hips
        else:
            Rw[:, j] = Rw[:, p] @ Rl[:, j]
            P[:, j] = P[:, p] + Rw[:, p] @ offsets[j]
    return P


def source_camera(pred, joints, hips, yaw):
    """元の動画のカメラ（動かない 1 台）を、glb の座標で求める → dict(R (カメラ → glb の回転 3x3), c (位置 3), K (3x3), width, height, reprojPx)
    pred = GEM-X の hpe_results.pt。joints・hips = glb の座標の関節と腰（フレームごと。gemx2glb.py が回して床を引いて原点をずらした後の物）、yaw = 回した角度（ラジアン）。
    1. 世界の座標の腰の向き・位置と、カメラの座標の腰の向き・位置の差がカメラ（フレームごとに少し揺れるので平均）
    2. それを glb の座標（Y 軸まわりに yaw 回し、腰を合わせる）に移す
    3. 元の画（カメラの座標の推定）に骨がいちばん重なるよう、回転と位置を最小二乗で合わせ直す"""
    from scipy.optimize import least_squares

    g, c = pred['body_params_global'], pred['body_params_incam']
    Rw = Rotation.from_rotvec(g['global_orient'].float().numpy().astype(np.float64).reshape(-1, 3))
    Rc = Rotation.from_rotvec(c['global_orient'].float().numpy().astype(np.float64).reshape(-1, 3))
    tc = c['transl'].float().numpy().astype(np.float64).reshape(-1, 3)
    K = pred['K_fullimg'][0].numpy().astype(np.float64)
    Ry = Rotation.from_euler('y', yaw)
    Rt_all = Ry * (Rw * Rc.inv())  # フレームごとの カメラ → glb の回り
    R = Rt_all.mean().as_matrix()
    cpos = (hips - tc @ R.T).mean(0)

    L = len(joints)
    idx = np.unique(np.linspace(0, L - 1, min(60, L)).astype(int))
    Rt = Rt_all.as_matrix()[idx]
    rel = joints[idx] - joints[idx, :1]
    Jc = tc[idx, None] + np.einsum('nji,nkj->nki', Rt, rel)  # カメラの座標の関節 = カメラの座標の腰 + Rt^T · (関節 - 腰)
    uv_t = Jc[..., :2] / Jc[..., 2:3]

    def res(x):
        Rm = Rotation.from_rotvec(x[:3]).as_matrix() @ R
        Xc = (joints[idx] - x[3:]) @ Rm
        uv = Xc[..., :2] / np.maximum(Xc[..., 2:3], 1e-3)
        return ((uv - uv_t) * K[0, 0]).ravel()

    x0 = np.concatenate([np.zeros(3), cpos])
    r0 = float(np.sqrt(np.mean(res(x0) ** 2)))
    sol = least_squares(res, x0, loss='soft_l1', f_scale=20.0)
    r1 = float(np.sqrt(np.mean(res(sol.x) ** 2)))
    R = Rotation.from_rotvec(sol.x[:3]).as_matrix() @ R
    return {
        'R': R.tolist(),
        'c': sol.x[3:].tolist(),
        'K': K.tolist(),
        # GEM-X の K は画の真ん中が主点（estimate_K）なので、元の画の大きさは主点の 2 倍
        'width': int(round(K[0, 2] * 2)),
        'height': int(round(K[1, 2] * 2)),
        'reprojPx': [round(r0, 1), round(r1, 1)],
    }


def default_camera(P, width, height):
    """カメラの情報が無いとき: 正面（+Z）から全身が入る固定のカメラ"""
    hp = P[:, 0]
    top = P[..., 1].max()
    cx, cz = hp[:, 0].mean(), hp[:, 2].mean()
    f = height * 1.6
    dist = f * (top * 1.3) / height
    R = np.diag([1.0, -1.0, -1.0])  # カメラ → 世界: カメラの +Z（前）= 世界の -Z、+Y（下）= 世界の -Y
    c = np.array([cx, top * 0.5, cz + dist])
    K = np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1]])
    return {'R': R.tolist(), 'c': c.tolist(), 'K': K.tolist(), 'width': width, 'height': height}


SIDE_COL = {'L': (255, 170, 70), 'R': (70, 110, 255), 'C': (225, 225, 225)}  # BGR: 左 = 青、右 = 赤、真ん中 = 白


class SkelRenderer:
    """元の動画のカメラから見た棒人間（床の目・腰の跡つき）。左 = 青・右 = 赤・腰 = 黄"""

    def __init__(self, names, parents, P, cam, out_w, out_h, zoom=1.0):
        self.names, self.parents, self.P = names, parents, P
        self.R, self.c = np.array(cam['R']), np.array(cam['c'])
        K = np.array(cam['K'])
        src_w, src_h = cam['width'], cam['height']
        s = min(out_w / src_w, out_h / src_h)
        self.fx, self.fy = K[0, 0] * s * zoom, K[1, 1] * s * zoom
        self.cx, self.cy = out_w / 2 + (K[0, 2] - src_w / 2) * s * zoom, out_h / 2 + (K[1, 2] - src_h / 2) * s * zoom
        self.w, self.h = out_w, out_h
        self.k = out_h / 640.0  # 線の太さの倍率
        self.bones = []
        for j in range(len(names)):
            p = parents[j]
            if p < 0:
                continue
            n = names[j]
            finger = any(f'Hand{f}' in n for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'))
            face = n in ('Jaw', 'LeftEye', 'RightEye', 'HeadEnd')
            side = 'L' if n.startswith('Left') else 'R' if n.startswith('Right') else 'C'
            th = 1 if finger else (2 if face else max(2, round(4 * self.k)))
            self.bones.append((j, p, side, th, finger))
        self.base = self._grid()
        self.trail = self.P[:, 0].copy()
        self.trail[:, 1] = 0

    def project(self, X):
        Xc = (np.asarray(X) - self.c) @ self.R  # = R^T (X - c)
        z = Xc[..., 2]
        u = self.fx * Xc[..., 0] / np.maximum(z, 1e-6) + self.cx
        v = self.fy * Xc[..., 1] / np.maximum(z, 1e-6) + self.cy
        return np.stack([u, v], -1), z

    def _seg(self, img, a, b, col, th, n=40):
        ts = np.linspace(0, 1, n + 1)[:, None]
        uv, z = self.project(a + (b - a) * ts)
        for i in range(n):
            if z[i] > 0.15 and z[i + 1] > 0.15:
                cv2.line(img, tuple(np.round(uv[i] * 16).astype(int)), tuple(np.round(uv[i + 1] * 16).astype(int)), col, th, cv2.LINE_AA, shift=4)

    def _grid(self):
        img = np.zeros((self.h, self.w, 3), np.uint8)
        img[:] = (34, 30, 28)
        hp = self.P[:, 0]
        x0, x1 = np.floor(hp[:, 0].min() - 4), np.ceil(hp[:, 0].max() + 4)
        z0, z1 = np.floor(hp[:, 2].min() - 4), np.ceil(hp[:, 2].max() + 4)
        for x in np.arange(x0, x1 + 1e-6, 0.5):
            major = abs(x - round(x)) < 1e-6
            self._seg(img, np.array([x, 0, z0]), np.array([x, 0, z1]), (80, 74, 70) if major else (56, 52, 50), 1)
        for z in np.arange(z0, z1 + 1e-6, 0.5):
            major = abs(z - round(z)) < 1e-6
            self._seg(img, np.array([x0, 0, z]), np.array([x1, 0, z]), (80, 74, 70) if major else (56, 52, 50), 1)
        return img

    def draw(self, f):
        img = self.base.copy()
        f = int(np.clip(f, 0, len(self.P) - 1))
        # 腰の軌跡（床の上。全体を薄く、今までを濃く）と、今の腰の真下
        uv, z = self.project(self.trail)
        ok = z > 0.15
        pts = np.round(uv * 16).astype(np.int32)
        for i in range(len(pts) - 1):
            if ok[i] and ok[i + 1]:
                cv2.line(img, tuple(pts[i]), tuple(pts[i + 1]), (60, 150, 190) if i < f else (60, 80, 95), 2 if i < f else 1, cv2.LINE_AA, shift=4)
        if ok[f]:
            cv2.circle(img, tuple(pts[f]), int(6 * self.k * 16), (80, 200, 255), -1, cv2.LINE_AA, shift=4)
        uv, z = self.project(self.P[f])
        for j, p, side, th, finger in sorted(self.bones, key=lambda b: -(z[b[0]] + z[b[1]])):
            if z[j] <= 0.15 or z[p] <= 0.15:
                continue
            col = SIDE_COL[side]
            if finger:
                col = tuple(int(c * 0.85) for c in col)
            cv2.line(img, tuple(np.round(uv[p] * 16).astype(int)), tuple(np.round(uv[j] * 16).astype(int)), col, th, cv2.LINE_AA, shift=4)
        for j, p, side, th, finger in self.bones:
            if finger or z[j] <= 0.15:
                continue
            cv2.circle(img, tuple(np.round(uv[j] * 16).astype(int)), max(2, round(3.5 * self.k)) * 16, (255, 255, 255), -1, cv2.LINE_AA, shift=4)
        if z[0] > 0.15:
            cv2.circle(img, tuple(np.round(uv[0] * 16).astype(int)), int(max(3, 5 * self.k) * 16), (80, 200, 255), -1, cv2.LINE_AA, shift=4)
        return img
