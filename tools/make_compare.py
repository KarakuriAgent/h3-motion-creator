# 確認用の 3 枠の比較の動画（compare.mp4。1920x1080・30 コマ/秒）を作る:
#   ① 元の動画（H3）｜ ② 骨（GEM-X。bones.mp4）｜ ③ VRM（vrm.mp4）
# を横に並べ、同じ時刻のコマを同時に出す（3 本とも元の動画の 0 秒がそろっている）。見出しに動きの名前と品質の目安を書く。
# アプリのサーバが結果を受け取ったときに呼ぶ（GEM-X の venv の python: numpy・PIL。GPU は使わない）:
#   python tools/make_compare.py --source source.mp4 --bones bones.mp4 --vrm vrm.mp4 --frames 150 --info '{"title": "…", "lines": ["…"]}' --out compare.mp4
# どの依頼の compare.mp4 も同じ大きさ・同じ符号化なので、ffmpeg の concat（-c copy）でつなげる（POST /api/compare）
import argparse
import json
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
BG = (18, 19, 22)
PANEL_BG = (8, 8, 10)


def find_font(bold=False):
    for q in (['Noto Sans CJK JP:bold'] if bold else []) + ['Noto Sans CJK JP', 'IPAGothic', 'TakaoGothic', 'sans-serif:lang=ja']:
        r = subprocess.run(['fc-match', '-f', '%{file}', q], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return None


FONT_R, FONT_B = find_font(), find_font(True)


def font(size, bold=False):
    path = FONT_B if bold else FONT_R
    try:
        return ImageFont.truetype(path, size, index=0) if path else ImageFont.load_default(size)
    except OSError:
        return ImageFont.load_default(size)


def probe(path):
    s = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'json', path], capture_output=True, text=True, check=True).stdout)['streams'][0]
    return s['width'], s['height']


def read_frames(path, w, h, fps=None):
    """コマを RGB で読む（fps を指定すれば、その速さにそろえてから）"""
    vf = ([f'fps={fps}'] if fps else []) + [f'scale={w}:{h}:flags=lanczos,format=rgb24']
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', ','.join(vf), '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    n = w * h * 3
    frames = []
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        frames.append(np.frombuffer(b, np.uint8).reshape(h, w, 3))
    p.wait()
    return frames


def main():
    ap = argparse.ArgumentParser(prog='make_compare.py')
    ap.add_argument('--source', required=True)
    ap.add_argument('--bones', required=True)
    ap.add_argument('--vrm', required=True)
    ap.add_argument('--frames', type=int, required=True, help='骨のコマ数（30 コマ/秒にそろえた元の動画のコマ数）')
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--info', default='{}')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    info = json.loads(args.info)
    L = args.frames

    sw, sh = probe(args.source)
    side, gap = 24, 16
    head_h, label_h = 132, 64
    a = sw / sh
    ph = int(min(H - head_h - label_h - 40, (W - 2 * side - 2 * gap) / (3 * a))) // 2 * 2
    pw = int(round(ph * a)) // 2 * 2
    total_w = pw * 3 + 2 * gap
    x0 = (W - total_w) // 2
    xs = [x0, x0 + pw + gap, x0 + 2 * (pw + gap)]
    y0 = max(20, (H - (head_h + ph + label_h)) // 2)
    py = y0 + head_h

    panes = [read_frames(args.source, pw, ph, args.fps), read_frames(args.bones, pw, ph), read_frames(args.vrm, pw, ph)]
    for i, fr in enumerate(panes):
        if not fr:
            sys.exit(f'[make_compare] 動画のコマを読めません: {[args.source, args.bones, args.vrm][i]}')

    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((x0, y0), info.get('title', ''), font=font(44, True), fill=(240, 240, 240))
    for k, line in enumerate(info.get('lines', [])[:2]):
        d.text((x0, y0 + 64 + k * 32), line, font=font(22), fill=(190, 190, 195))
    labels = [('① 元の動画（H3）', 'source.mp4'), ('② 骨（GEM-X）', '青 = 左・赤 = 右・黄 = 腰と腰の跡'), ('③ VRM', 'motion.vrma をモデルに載せた物')]
    for x, (t1, t2) in zip(xs, labels):
        d.rectangle([x, py, x + pw - 1, py + ph - 1], fill=PANEL_BG)
        d.text((x + pw // 2, py + ph + 8), t1, font=font(24, True), fill=(235, 235, 235), anchor='ma')
        d.text((x + pw // 2, py + ph + 40), t2, font=font(16), fill=(150, 150, 155), anchor='ma')
    base = np.asarray(im).copy()

    enc = subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(args.fps), '-i', '-', '-an',
         '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
         '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', args.out],
        stdin=subprocess.PIPE,
    )
    tfont = font(24)
    for f in range(L):
        frame = base.copy()
        for x, fr in zip(xs, panes):
            frame[py : py + ph, x : x + pw] = fr[min(f, len(fr) - 1)]
        img = Image.fromarray(frame)
        ImageDraw.Draw(img).text((xs[2] + pw, y0 + 12), f't = {f / args.fps:5.2f} s', font=tfont, fill=(170, 170, 175), anchor='ra')
        enc.stdin.write(np.asarray(img).tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit('[make_compare] ffmpeg が失敗しました')
    print(f'[make_compare] -> {args.out}（{L} コマ、枠 {pw}x{ph}）')


if __name__ == '__main__':
    main()
