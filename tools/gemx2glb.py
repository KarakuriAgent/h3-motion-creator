# GEM-X（NVlabs/GEM-X）の推定の結果（hpe_results.pt の body_params_global。SOMA の 77 関節）を、骨組み + アニメーション 1 本の glb（bones.glb）にする。
# tools/to_vrma/to_vrma.mjs がこの glb を .vrma にする。stats.json に品質の目安と、元の動画のカメラ（確認用の骨の動画に使う）を書く。
# 使い方（ふつうは tools/gemx.sh が呼ぶ。GEM-X の venv の python で、GEM-X の根で動かす）:
#   cd <GEM-X> && .venv/bin/python <アプリ>/tools/gemx2glb.py --in <hpe_results.pt> --out <bones.glb> [--facing start|mean|ends] [--floor track|fixed] [--stats <stats.json>] [--list]
#
# 骨組みの作り方:
#   - SOMA の回転（global_orient と body_pose。軸と角度）は「T ポーズからの回り」のローカルの回転で、
#     T ポーズの骨の向き（joint orient）を骨ごとに掛けた物が本当の向き（world_abs = FK(rel) · orient）。
#     なので「T ポーズの関節の位置に、回転なしで骨を置いた骨組み」に、rel の回転をそのままローカルの回転として載せれば、関節の位置が SOMA と同じになる
#     （ランダムな姿勢で、この骨組みの FK と SOMA の関節の位置の差は最大 2e-7 m）。to_vrma.mjs はこの基本姿勢を T ポーズの基準として読む
#   - 骨の長さはその人の体（identity_coeffs・scale_params のクリップの平均。GEM-X の temporal_forward と同じ）の T ポーズから取る
#   - transl は腰（Hips）のワールドの位置（m）。GEM-X の世界の座標は Y が上（重力の向き）・前の向きは決まっていない
#     → Y 軸まわりに回して、前（--facing の所の、左右の股関節と肩を結ぶ向きが +X）を +Z にそろえる（VRM は +Z が前・+X が本人の左）
#   - 床: フレームごとの体の表面（メッシュの頂点）のいちばん低い所の、前後 --floor_window 秒の最小値をならした物を y = 0 にする（GEM-X の世界の座標は上下に
#     ゆっくりずれるので、フレームごとに追う。窓より短い跳びは残る。--floor fixed で 1 つの高さ）。骨組みの基本姿勢の腰の高さは、T ポーズで足の裏が y = 0 に来る高さ
#   - 腰の水平の位置は、1 フレーム目が原点に来るようにずらす
#   - コマ数: 入れた動画のコマ数のまま（gemx_infer.py が GEM-X に入れる前に 30 コマ/秒にそろえる）。--fps で書く
#   - 骨の名前は SOMA の名前のまま（Hips・Spine1・LeftArm・LeftHandIndex2 など。VRM の骨との対応は tools/to_vrma/soma-bones.mjs）。
#     先の骨（*End）・目・あごも入れる（使わない骨は対応表に無いので飛ばされる）
# --stats: 品質の目安（足の滑り・床に沈む/浮く・震え）と元の動画のカメラ（camera）を JSON に書く。--list: 骨の名前と親を表示する
import argparse
import json
import os
import struct
import sys
from pathlib import Path

import numpy as np
import torch
from scipy.spatial.transform import Rotation

GEM_ROOT = Path(os.environ.get('GEMX_ROOT', Path.cwd()))
sys.path.insert(0, str(GEM_ROOT))

ap = argparse.ArgumentParser(prog='gemx2glb.py')
ap.add_argument('--in', dest='inp', required=True, help='GEM-X の hpe_results.pt')
ap.add_argument('--out', required=True, help='書き出す glb')
ap.add_argument('--name', default=None, help='アニメーションの名前（既定は glb の名前）')
ap.add_argument('--fps', type=float, default=30.0)
ap.add_argument('--facing', choices=['start', 'mean', 'ends'], default='start', help='前にそろえる向きを測る所（始めの 0.5 秒 / 全体 / 前後の 0.5 秒）')
ap.add_argument('--floor', choices=['track', 'fixed'], default='track', help='床の決め方（track = フレームごとに上下のずれを追う / fixed = 1 つ）')
ap.add_argument('--floor_window', type=float, default=1.0, help='床を追うときの前後の秒')
ap.add_argument('--stats', default=None, help='品質の目安を書く JSON')
ap.add_argument('--no_camera', action='store_true', help='stats.json に元の動画のカメラを書かない')
ap.add_argument('--list', action='store_true')
args = ap.parse_args()

# hpe_results.pt は GEM-X が書いた物で、numpy の配列も入っているので weights_only=False（GEM-X の demo_soma.py と同じ。人から受け取った .pt は読まない）
pred = torch.load(args.inp, map_location='cpu', weights_only=False)
bp = pred['body_params_global']
go = bp['global_orient'].float().reshape(-1, 3).numpy()  # (L, 3)
body = bp['body_pose'].float().reshape(go.shape[0], 76, 3).numpy()  # (L, 76, 3)
transl = bp['transl'].float().reshape(-1, 3).numpy()  # (L, 3)
idc = bp['identity_coeffs'].float().reshape(go.shape[0], -1)
scale = bp['scale_params'].float().reshape(go.shape[0], -1)
L = go.shape[0]

from gem.utils.soma_utils.soma_layer import SomaLayer  # noqa: E402

soma = SomaLayer(data_root=str(GEM_ROOT / 'inputs/soma_assets'), low_lod=True, device='cpu', identity_model_type='mhr', mode='warp')
rig = np.load(GEM_ROOT / 'inputs/soma_assets/SOMA_neutral.npz', allow_pickle=False)
names = [str(n) for n in rig['joint_names'][1:]]  # Root を除いた 77 本（姿勢の並びと同じ）
parents = [int(p) for p in soma.parents]  # 77 本の中の親の番号（腰は -1）

# その人の体の T ポーズ（腰が原点）。クリップの平均の体（GEM-X の temporal_forward と同じ）
with torch.no_grad():
    idm = idc.mean(0, keepdim=True)
    scm = scale.mean(0, keepdim=True)
    t0 = soma.static_forward(torch.zeros(1, 77, 3), idm, scm, torch.zeros(1, 3))
tj = t0['joints'][0].detach().numpy().astype(np.float64)  # (77, 3)
rest_floor = float(t0['vertices'][0, :, 1].min())
rest_hips_y = -rest_floor  # 足の裏が y = 0 に来る腰の高さ

if args.list:
    print(f'[gemx2glb] 骨（{len(names)} 本）:')
    for i, n in enumerate(names):
        print(f'  {n}  <- {names[parents[i]] if parents[i] >= 0 else "(根)"}')

# フレームごとの関節の位置と、体の表面のいちばん低い所（床を決める・品質の目安）。GEM-X と同じ temporal_forward で
with torch.no_grad():
    poses = torch.from_numpy(np.concatenate([go[:, None], body], 1)).float()[None]
    out = soma.temporal_forward(poses, idc[None], scale[None], torch.from_numpy(transl).float()[None])
joints = out['joints'][0].detach().numpy().astype(np.float64)  # (L, 77, 3)
vmin = out['vertices'][0, :, :, 1].min(-1).values.detach().numpy().astype(np.float64)  # (L,)
del out

# 向き: 左右の股関節を結ぶ向き（+ 肩）が +X になるよう、Y 軸まわりに回す
I = {n: i for i, n in enumerate(names)}
k = max(1, min(15, L // 4))
pick = {'start': list(range(k)), 'mean': list(range(L)), 'ends': list(range(k)) + list(range(L - k, L))}[args.facing]
side = (joints[pick, I['LeftLeg']] - joints[pick, I['RightLeg']]) + (joints[pick, I['LeftArm']] - joints[pick, I['RightArm']])
v = side.mean(0)
yaw = np.arctan2(v[2], v[0])  # v を +X に回す Y 軸まわりの角度
Ry = Rotation.from_euler('y', yaw)
Rm = Ry.as_matrix()
joints = joints @ Rm.T
hips = transl @ Rm.T
root_rot = (Ry * Rotation.from_rotvec(go)).as_quat()  # (L, 4) xyzw

# 床: GEM-X の世界の座標は上下にゆっくりずれる（試しの動画で 15 秒に約 30cm 下がった）。
# フレームごとの体のいちばん低い所の、前後 --floor_window 秒の最小値（跳んでいる間は足が床に着いているフレームの高さになる）を、
# ガウスでならしてフレームごとに引く（--floor fixed なら、全体の低いほうから 5% の所を 1 つだけ引く）
if args.floor == 'fixed':
    floor = np.full(L, np.percentile(vmin, 5))
else:
    r = max(1, int(round(args.floor_window * args.fps)))
    env = np.array([vmin[max(0, t - r) : t + r + 1].min() for t in range(L)])
    sig = args.floor_window * args.fps / 2
    k = np.exp(-0.5 * (np.arange(-3 * int(sig) - 1, 3 * int(sig) + 2) / sig) ** 2)
    pad = np.pad(env, len(k) // 2, mode='edge')
    floor = np.convolve(pad, k / k.sum(), mode='valid')[:L]
joints[..., 1] -= floor[:, None]
hips[:, 1] -= floor
vmin = vmin - floor
# 水平の位置: 1 フレーム目の腰が原点
off = np.array([hips[0, 0], 0.0, hips[0, 2]])
joints -= off
hips -= off

# ローカルの回転（xyzw）。腰は向きをそろえた物、ほかは SOMA のまま
quats = np.zeros((L, 77, 4), dtype=np.float64)
quats[:, 0] = root_rot
quats[:, 1:] = Rotation.from_rotvec(body.reshape(-1, 3)).as_quat().reshape(L, 76, 4)
# 補間で遠回りしないよう、前のフレームと同じ側の符号にそろえる
for t in range(1, L):
    flip = (quats[t] * quats[t - 1]).sum(-1) < 0
    quats[t, flip] *= -1

# --- glb に書く ---
times = (np.arange(L) / args.fps).astype(np.float32)
offsets = np.zeros((77, 3))
for j in range(77):
    offsets[j] = tj[j] - tj[parents[j]] if parents[j] >= 0 else np.array([0.0, rest_hips_y, 0.0])
children = [[c for c in range(77) if parents[c] == j] for j in range(77)]
nodes = []
for j in range(77):
    n = {'name': names[j], 'translation': [float(x) for x in offsets[j]]}
    if children[j]:
        n['children'] = children[j]
    nodes.append(n)

blobs = []
views = []
accessors = []
length = 0


def add(arr, typ, minmax=False):
    global length
    data = np.ascontiguousarray(arr, dtype=np.float32).tobytes()
    views.append({'buffer': 0, 'byteOffset': length, 'byteLength': len(data)})
    blobs.append(data)
    length += len(data)
    size = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[typ]
    a = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(data) // (4 * size), 'type': typ}
    if minmax:
        a['min'] = [float(arr.min())]
        a['max'] = [float(arr.max())]
    accessors.append(a)
    return len(accessors) - 1


inp = add(times, 'SCALAR', True)
samplers = [{'input': inp, 'output': add(hips, 'VEC3'), 'interpolation': 'LINEAR'}]
channels = [{'sampler': 0, 'target': {'node': 0, 'path': 'translation'}}]
for j in range(77):
    samplers.append({'input': inp, 'output': add(quats[:, j], 'VEC4'), 'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers) - 1, 'target': {'node': j, 'path': 'rotation'}})

name = args.name or Path(args.out).stem
gltf = {
    'asset': {'version': '2.0', 'generator': 'h3-motion-creator gemx2glb.py (GEM-X / SOMA)'},
    'scene': 0,
    'scenes': [{'nodes': [0]}],
    'nodes': nodes,
    'animations': [{'name': name, 'channels': channels, 'samplers': samplers}],
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': length}],
}
js = json.dumps(gltf, ensure_ascii=False).encode('utf8')
js += b' ' * ((4 - len(js) % 4) % 4)
bin_ = b''.join(blobs)
bin_ += b'\0' * ((4 - len(bin_) % 4) % 4)
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
with open(args.out, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin_)))
    f.write(struct.pack('<I4s', len(js), b'JSON') + js)
    f.write(struct.pack('<I4s', len(bin_), b'BIN\0') + bin_)

# --- 品質の目安 ---
dt = 1.0 / args.fps
stats = {'frames': L, 'seconds': round(L / args.fps, 3), 'fps': args.fps, 'facingYawDeg': round(float(np.degrees(yaw)), 1), 'floorShiftM': [round(float(floor.min()), 3), round(float(floor.max()), 3)]}
# 床: 体の表面のいちばん低い所（フレームごと）。立っているはずのフレームで沈む（< 0）・浮く量
stats['lowestPointCm'] = {'p5': round(float(np.percentile(vmin, 5)) * 100, 1), 'median': round(float(np.median(vmin)) * 100, 1), 'min': round(float(vmin.min()) * 100, 1)}
# 足の滑り: 足（つま先の付け根）が床から 5cm 以内で、上下にほとんど動いていないフレームの、水平の速さ
slide = {}
for s in ['Left', 'Right']:
    p = joints[:, I[f'{s}ToeBase']]
    rest_h = tj[I[f'{s}ToeBase'], 1] + rest_hips_y
    h = p[:, 1] - rest_h
    vel = np.linalg.norm(np.diff(p[:, [0, 2]], axis=0), axis=1) / dt
    vy = np.abs(np.diff(p[:, 1])) / dt
    contact = (h[1:] < 0.05) & (vy < 0.2)
    slide[s] = {'contactRatio': round(float(contact.mean()), 2), 'medianCmPerSec': round(float(np.median(vel[contact]) * 100), 1) if contact.any() else None, 'p90CmPerSec': round(float(np.percentile(vel[contact], 90) * 100), 1) if contact.any() else None}
stats['footSlide'] = slide
# 腰の動き（水平・上下の幅）
stats['hipsRangeCm'] = {ax: round(float(np.ptp(hips[:, i])) * 100, 1) for i, ax in enumerate('xyz')}
# 震え: 関節の位置の 2 階差分（加速度）の、低い周波数を除いた大きさ（m/s^2 の中央値。手首・足首・頭）
acc = np.linalg.norm(joints[2:] - 2 * joints[1:-1] + joints[:-2], axis=-1) / dt**2
stats['jitterAccMedian'] = {n: round(float(np.median(acc[:, I[n]])), 2) for n in ['Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftHandIndex4']}
# 元の動画のカメラ（glb の座標。確認用の骨の動画を元の画に重ねて描くのに使う。tools/render_bones.py）
if not args.no_camera:
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from skel import source_camera  # noqa: E402

        stats['camera'] = source_camera(pred, joints, hips, yaw)
    except Exception as e:  # カメラが求まらなくても glb と品質の目安は使える
        print(f'[gemx2glb] 注意: 元の動画のカメラを求められません: {e}')
if args.stats:
    os.makedirs(os.path.dirname(os.path.abspath(args.stats)), exist_ok=True)
    with open(args.stats, 'w') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
print(f'[gemx2glb] {args.inp} -> {args.out}（{L} フレーム、{args.fps:g} コマ/秒、向き {np.degrees(yaw):.1f}°、床 {floor.min():+.3f}〜{floor.max():+.3f} m）')
print(f'[gemx2glb] 品質の目安: {json.dumps(stats, ensure_ascii=False)}')
