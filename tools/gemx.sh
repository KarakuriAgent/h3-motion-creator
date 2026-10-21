#!/usr/bin/env bash
#
# 動画 1 本 → GEM-X の推定 → 骨の glb（bones.glb）と品質の目安（stats.json。元の動画のカメラも入る）。
#   tools/gemx.sh <動画.mp4> <出力のフォルダ> [--facing start|mean|ends] [--floor track|fixed] [--floor_window 秒] [--moving_cam]
#   出力: <出力のフォルダ>/bones.glb・stats.json・gemx-out/<動画の名前>/（hpe_results.pt・2D の関節を重ねた 0_kp2d77_overlay.mp4・30 コマ/秒にした動画）
#   GEM-X の場所: 環境変数 GEMX_ROOT。無ければアプリの設定（GET <アプリ>/api/settings の resolved.gemxPath。アプリの URL は APP_URL、既定 http://127.0.0.1:4170）
#   推定は中間ファイルがあれば飛ばす（同じ名前の動画を作り直したら gemx-out/<名前>/ を消す）。--facing などを変えて glb だけ作り直すのは速い
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_URL="${APP_URL:-http://127.0.0.1:4170}"
if [ $# -lt 2 ]; then
    sed -n '3,8p' "$0" >&2
    exit 2
fi
VIDEO="$(realpath "$1")"
OUT="$(realpath -m "$2")"
shift 2
GLB_ARGS=()
INFER_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --moving_cam) INFER_ARGS+=("$1"); shift ;;
        --facing|--floor|--floor_window) GLB_ARGS+=("$1" "$2"); shift 2 ;;
        *) echo "知らないオプション: $1" >&2; exit 2 ;;
    esac
done
if [ -z "${GEMX_ROOT:-}" ]; then
    GEMX_ROOT="$(curl -sf "${APP_URL}/api/settings" 2>/dev/null | sed -n 's/.*"gemxPath":"\([^"]*\)","gemxPathFromSettings".*/\1/p')"
fi
if [ -z "${GEMX_ROOT:-}" ] || [ ! -x "${GEMX_ROOT}/.venv/bin/python" ]; then
    echo "エラー: GEM-X が見つかりません（GEMX_ROOT=${GEMX_ROOT:-} 。環境変数 GEMX_ROOT か、アプリの設定の GEM-X のパス）" >&2
    exit 1
fi
PY="${GEMX_ROOT}/.venv/bin/python"
NAME="$(basename "${VIDEO%.*}")"
mkdir -p "$OUT/gemx-out"

# GPU の空き（GEM-X は最大 8GiB ほど使う）
if command -v nvidia-smi > /dev/null; then
    FREE=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
    if [ "${FREE:-0}" -lt 8192 ]; then
        echo "[gemx] 注意: GPU の空きが ${FREE} MiB です。足りなければ tools/free_vram.sh で ComfyUI のモデルを外す（ComfyUI は止めない）" >&2
    fi
fi

echo "[gemx] 推定: ${VIDEO}"
(cd "$GEMX_ROOT" && GEMX_ROOT="$GEMX_ROOT" "$PY" "$HERE/gemx_infer.py" --video "$VIDEO" --output_root "$OUT/gemx-out" "${INFER_ARGS[@]}")
echo "[gemx] glb に書き出す"
(cd "$GEMX_ROOT" && GEMX_ROOT="$GEMX_ROOT" "$PY" "$HERE/gemx2glb.py" --in "$OUT/gemx-out/$NAME/hpe_results.pt" --out "$OUT/bones.glb" --stats "$OUT/stats.json" "${GLB_ARGS[@]}")
echo "[gemx] できた: $OUT/bones.glb・$OUT/stats.json（2D の関節を重ねた動画: $OUT/gemx-out/$NAME/0_kp2d77_overlay.mp4）"
