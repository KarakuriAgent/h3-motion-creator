# GEM-X（NVlabs/GEM-X）で、動画 1 本から SOMA の 77 関節の動き（hpe_results.pt）を推定する。
# GEM-X の scripts/demo/demo_soma.py の関数を読んで、同じ順に動かす（GEM-X のファイルは変えない）。demo との違い:
#   - 入れる前に動画を 30 コマ/秒にそろえる（ffmpeg。GEM-X の demo は 30 コマ/秒として扱う。H3 の 24 コマ/秒の動画のままだと時間が 0.8 倍に縮む）
#   - 既定はカメラ固定（--static_cam。H3 の動画はカメラ固定で作る。GEM-X の demo も VO が無いときは固定のカメラとして扱う）
#   - メッシュを重ねた動画は --render のときだけ（遅い）。2D の関節を重ねた動画（0_kp2d77_overlay.mp4）は既定で作る（確かめ用）
#   - 段ごとに GPU のメモリを空ける（ComfyUI と同じ GPU を分けて使うため）
# 使い方（ふつうは tools/gemx.sh が呼ぶ。GEM-X の venv の python で、GEM-X の根で動かす）:
#   cd <GEM-X> && .venv/bin/python <アプリ>/tools/gemx_infer.py --video <mp4> --output_root <出力の根> [--moving_cam] [--render] [--no_kp2d]
#   出力: <出力の根>/<動画の名前>/hpe_results.pt（と preprocess/ の中間ファイル、0_kp2d77_overlay.mp4、30 コマ/秒にそろえた <動画の名前>.mp4）
#   中間ファイルがあれば、その段は飛ばす（作り直すときは <出力の根>/<動画の名前>/ を消す）
import argparse
import gc
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
os.environ.setdefault('EGL_PLATFORM', 'surfaceless')

GEM_ROOT = Path(os.environ.get('GEMX_ROOT', Path.cwd())).resolve()
if not (GEM_ROOT / 'scripts/demo/demo_soma.py').exists():
    sys.exit(f'[gemx_infer] GEM-X の根で動かしてください（今: {GEM_ROOT}。環境変数 GEMX_ROOT でも指せる）')
os.chdir(GEM_ROOT)  # GEM-X は inputs/ を今のフォルダからの相対で読む
sys.path.insert(0, str(GEM_ROOT))

ap = argparse.ArgumentParser(prog='gemx_infer.py')
ap.add_argument('--video', required=True)
ap.add_argument('--output_root', required=True)
ap.add_argument('--moving_cam', action='store_true', help='カメラが動く動画（既定はカメラ固定。GEM-X に VO が無いので、今は固定と同じ扱いになる）')
ap.add_argument('--render', action='store_true', help='メッシュを重ねた動画も作る（遅い）')
ap.add_argument('--no_kp2d', action='store_true', help='2D の関節を重ねた動画を作らない')
ap.add_argument('--fps', type=int, default=30)
args = ap.parse_args()

spec = importlib.util.spec_from_file_location('demo_soma', GEM_ROOT / 'scripts/demo/demo_soma.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)  # torch.load を weights_only=False にするのも demo の中
import torch  # noqa: E402

video = Path(args.video).resolve()
ckpt = GEM_ROOT / 'inputs/pretrained/gem_soma.ckpt'
cfg = demo._build_cfg(
    argparse.Namespace(
        video=str(video),
        output_root=str(Path(args.output_root).resolve()),
        static_cam=not args.moving_cam,
        verbose=False,
        render_mhr=False,
        ckpt=str(ckpt) if ckpt.exists() else None,
        sam3d_ckpt_path=None,
        sam3d_mhr_path=None,
        exp='gem_soma_regression',
    )
)

# 30 コマ/秒にそろえた写しを出力のフォルダに置く（demo の _copy_video_if_needed が置く所と同じ。コマ数が同じなら demo は作り直さない）
dst = Path(cfg.output_dir) / f'{cfg.video_name}.mp4'
dst.parent.mkdir(parents=True, exist_ok=True)
if not dst.exists() or dst.stat().st_mtime < video.stat().st_mtime:
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(video), '-vf', f'fps={args.fps}', '-an', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', str(dst)], check=True)
cfg.video_path = str(dst)


def free():
    gc.collect()
    torch.cuda.empty_cache()


demo.run_preprocess(cfg)
free()
if not args.no_kp2d:
    demo.render_2d_keypoints(video_path=cfg.video_path, vitpose_path=cfg.paths.vitpose, bbx_path=cfg.paths.bbx, output_path=str(Path(cfg.output_dir) / '0_kp2d77_overlay.mp4'), fps=args.fps)
data = demo.load_data_dict(cfg)
if not Path(cfg.paths.hpe_results).exists():
    import hydra

    model = hydra.utils.instantiate(cfg.model, _recursive_=False)
    model.load_pretrained_model(demo.resolve_ckpt_path(cfg))
    model = model.eval().cuda()
    with torch.no_grad():
        pred = model.predict(data, static_cam=cfg.static_cam, postproc=True)
    torch.save(demo.detach_to_cpu(pred), cfg.paths.hpe_results)
    del model, pred
    free()
if args.render:
    demo.render_incam(cfg, fps=args.fps)
    demo.render_global_o3d(cfg, fps=args.fps)
    demo.merge_videos_horizontal([cfg.paths.incam_video, cfg.paths.global_video], cfg.paths.incam_global_horiz_video)
print(f'[gemx_infer] {video} -> {cfg.paths.hpe_results}（GPU のメモリの最大 {torch.cuda.max_memory_allocated() / 2**30:.1f} GiB）')
