# 確認用の骨の動画（bones.mp4）を作る: bones.glb の骨を、元の動画のカメラ（stats.json の camera）から見た棒人間で描く。
# 床の目は 50cm（太い線は 1m）・左 = 青・右 = 赤・黄 = 腰と腰の跡。コマは glb のまま（30 コマ/秒 = 元の動画と同じ時間の軸）。
# アプリのサーバが結果を受け取ったときに呼ぶ（GEM-X の venv の python。GPU は使わない）:
#   python tools/render_bones.py --glb bones.glb --stats stats.json --out bones.mp4 [--width 480 --height 864] [--fps 30]
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from skel import SkelRenderer, default_camera, fk, load_glb  # noqa: E402

ap = argparse.ArgumentParser(prog='render_bones.py')
ap.add_argument('--glb', required=True)
ap.add_argument('--stats', default=None)
ap.add_argument('--source', default=None, help='元の動画（大きさを合わせるだけ）')
ap.add_argument('--out', required=True)
ap.add_argument('--width', type=int, default=0)
ap.add_argument('--height', type=int, default=0)
ap.add_argument('--fps', type=float, default=30.0)
args = ap.parse_args()

names, parents, offsets, hips, quats, _ = load_glb(args.glb)
P = fk(parents, offsets, hips, quats)
cam = None
if args.stats and Path(args.stats).exists():
    cam = json.loads(Path(args.stats).read_text(encoding='utf-8')).get('camera')
w, h = args.width, args.height
if not (w and h):
    if cam:
        w, h = cam['width'], cam['height']
    else:
        w, h = 480, 864
if not cam:
    print('[render_bones] stats.json にカメラが無いので、正面の固定のカメラで描く')
    cam = default_camera(P, w, h)

enc = subprocess.Popen(
    ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}', '-r', str(args.fps), '-i', '-', '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.out],
    stdin=subprocess.PIPE,
)
rend = SkelRenderer(names, parents, P, cam, w, h)
for f in range(len(P)):
    img = rend.draw(f)
    cv2.putText(img, f'{f / args.fps:5.2f}s', (10, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5 * h / 640 + 0.2, (170, 170, 175), 1, cv2.LINE_AA)
    enc.stdin.write(np.ascontiguousarray(img).tobytes())
enc.stdin.close()
if enc.wait() != 0:
    sys.exit('[render_bones] ffmpeg が失敗しました')
print(f'[render_bones] {args.glb} -> {args.out}（{len(P)} コマ、{w}x{h}）')
