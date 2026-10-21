#!/usr/bin/env bash
#
# ComfyUI を止めずに、読み込み済みのモデルを GPU のメモリから外す（ComfyUI の POST /free）。GEM-X を動かす前に、空きが足りなければ使う（任意）。
#
#   接続先: 環境変数 COMFYUI_URL。無ければアプリの設定（GET <アプリ>/api/settings の comfyuiUrl。アプリの URL は環境変数 APP_URL、既定 http://127.0.0.1:4170）、
#           それも取れなければ http://127.0.0.1:8188
#
set -uo pipefail

APP_URL="${APP_URL:-http://127.0.0.1:4170}"
if [ -z "${COMFYUI_URL:-}" ]; then
    COMFYUI_URL="$(curl -sf "${APP_URL}/api/settings" 2>/dev/null | sed -n 's/.*"comfyuiUrl":"\([^"]*\)".*/\1/p')"
fi
COMFYUI_URL="${COMFYUI_URL:-http://127.0.0.1:8188}"

if ! curl -sf -X POST -H "Content-Type: application/json" \
        -d '{"unload_models": true, "free_memory": true}' \
        "${COMFYUI_URL}/free" > /dev/null; then
    echo "エラー: ComfyUI に接続できません: ${COMFYUI_URL}" >&2
    exit 1
fi

echo "GPU のメモリの解放を ${COMFYUI_URL} に頼みました（実行中のプロンプトがあれば、終わってから外れます）。"

if command -v nvidia-smi > /dev/null; then
    sleep 2
    echo
    nvidia-smi --query-gpu=memory.used,memory.total --format=csv
fi
