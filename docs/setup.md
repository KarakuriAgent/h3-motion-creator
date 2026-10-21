# セットアップの手順（エージェント用）

h3-motion-creator の画面の「環境チェック／設定」が作ったセットアップの依頼文を、人があなた（コーディングエージェント）に貼った。
依頼文の「足りない物」**だけ**を、この手順で入れる。済んでいる物には触らない。

## 1. 決まり

- **既にある ComfyUI・システムの CUDA とドライバは変えない**。既にある ComfyUI の venv に足すのは、足りない物（カスタムノードの requirements・SageAttention）だけ
- 設定のパスが空の物は、**プロジェクトの `vendor/` の中に clone して作る**（`vendor/ComfyUI`・`vendor/GEM-X`。`vendor/` は git の外）
- 動いている ComfyUI を止める・再起動するのは、人に確かめてから
- モデルの重みは配布元から取る。アプリのリポジトリには入れない。使うモデルはそれぞれの配布元の決まりに従う
- sudo が要る物（ドライバ・ffmpeg など）は人に頼む
- 終わったら、作ったパスを設定に書き（§7）、`GET /api/env` がすべて OK になるのを確かめて、入れた物と版を報告する

確かめるコマンド:

```bash
APP=http://127.0.0.1:4170
curl -s $APP/api/env | python3 -c "import json,sys; d=json.load(sys.stdin); print('ready', d['ready']); [print(i['state'], i['label'], '|', i['detail']) for i in d['items']]"
```

## 2. ComfyUI（パスが空で、vendor/ComfyUI に作るとき）

URL（既定 `http://127.0.0.1:8188`）で別の ComfyUI がもう動いているなら、新しく作らず、そのフォルダを人に聞いて設定に書く（同じポートで 2 つは動かせない）。

### 2.1 本体と venv

```bash
cd <アプリのフォルダ>
git clone https://github.com/Comfy-Org/ComfyUI vendor/ComfyUI
cd vendor/ComfyUI
uv venv venv --python 3.12
export VIRTUAL_ENV=$PWD/venv PATH=$PWD/venv/bin:$PATH
# PyTorch は GPU に合う CUDA の版で（nvidia-smi の CUDA Version 以下）。RTX 50 系（Blackwell・sm_120）は cu128 以上
uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
uv pip install -r requirements.txt
```

MiniMax H3 のノード（`MiniMaxH3ReferenceToVideo`・`MiniMaxH3SigmaShift`）と `BlockSparseAttention` は ComfyUI の本体に入っている（`comfy_extras/nodes_minimax_h3.py`・`nodes_sparse_attention.py`）。
既にある ComfyUI にこれらが無いときは、本体が古い。上げるかは人に確かめる。

### 2.2 カスタムノード

```bash
cd <ComfyUI のフォルダ>/custom_nodes
git clone https://github.com/kijai/ComfyUI-KJNodes                 # PathchSageAttentionKJ・MiniMaxH3MemoryEfficientSageAttentionPatch
git clone https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3     # SpectrumApplyMiniMaxH3
for d in ComfyUI-KJNodes ComfyUI-Spectrum-MiniMax-H3; do [ -f $d/requirements.txt ] && <ComfyUI の venv>/bin/python -m pip install -r $d/requirements.txt; done
```

### 2.3 SageAttention

ComfyUI の venv に入れる。GPU・torch・CUDA の版に合う物を選ぶ（合わない物を入れると ComfyUI が起動しなくなるので、入れる前に torch の版を見る）:

```bash
<ComfyUI の venv>/bin/python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.get_device_capability())"
<ComfyUI の venv>/bin/python -m pip install sageattention       # 合う wheel が無ければ https://github.com/thu-ml/SageAttention をソースからビルド
<ComfyUI の venv>/bin/python -c "import sageattention"           # 環境チェックはこれを見る
```

### 2.4 起動

```bash
cd <ComfyUI のフォルダ> && venv/bin/python main.py --listen 127.0.0.1 --port 8188
```

起動のログでカスタムノードの読み込みの失敗が無いことを見る。`GET http://127.0.0.1:8188/object_info` にワークフローのノードが全部あれば、環境チェックの「ComfyUI にノードが登録されている」が OK になる。

## 3. H3 のモデル

ComfyUI の `models/` の下に置く（`extra_model_paths.yaml` で別の所に置いてもよい。そのときは同じ ComfyUI の `/object_info` に名前が出れば OK）。
ワークフロー（`workflows/minimax_h3_r2v_turbo.json`）が読むファイル名のまま置く:

| 置く所 | ファイル | 配布元（確かめてから取る） |
|---|---|---|
| `models/diffusion_models/` | `minimax_h3_fl2va_pruned_w4a8_mixed.safetensors` | Hugging Face `Kijai/MiniMax-H3-experimental` |
| `models/loras/` | `minimax_h3_ref_lora_rank_256_bf16.safetensors`（参照 LoRA） | Hugging Face `Kijai/MiniMax-H3-experimental`（`loras/`） |
| `models/loras/` | `minimax_h3_fl2v_turbo_4step_v1.3_768p_comfyui_bf16.safetensors`（4step 蒸留 LoRA） | Hugging Face `lightx2v/Minimax-h3-Turbo` |
| `models/vae/` | `minimax_h3_video_vae_int8_convrot.safetensors`・`minimax_h3_audio_vae_fp32.safetensors` | Hugging Face `Comfy-Org/MiniMax-H3`（`vae/`） |
| `models/text_encoders/` | `qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors` | Hugging Face `Momoking/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4` |

```bash
hf download Kijai/MiniMax-H3-experimental minimax_h3_fl2va_pruned_w4a8_mixed.safetensors --local-dir /tmp/h3dl   # 例。取った物を上の所へ移す
```

- 合わせて 35GB ほど。ディスクの空きを先に見る

## 4. GEM-X（パスが空で、vendor/GEM-X に作るとき）

GEM-X（NVlabs/GEM-X）は動画から体の 77 関節（体・指）と腰の軌跡を推定する。アプリは GEM-X のファイルを変えず、その venv の python で `tools/gemx_infer.py`・`tools/gemx2glb.py`・`tools/render_bones.py`・`tools/make_compare.py` を動かす。

### 4.1 clone（詰まり所が 2 つ）

```bash
cd <アプリのフォルダ>
git clone --recursive https://github.com/NVlabs/GEM-X vendor/GEM-X     # soma-retargeter のサブモジュールは SSH の URL（git@github.com:）なので、鍵が無いとここで止まる
cd vendor/GEM-X
git -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init --recursive   # https に読み替えて取り直す
(cd third_party/sam-3d-body && git checkout -f HEAD)                   # 1 回目の clone が途中で止まると、中身が空のまま残る
(cd third_party/soma && git lfs pull)                                  # SOMA の体の形（約 800MB。git-lfs が要る）
```

### 4.2 venv と PyTorch（CUDA の版に注意）

```bash
uv venv .venv --python 3.12
export VIRTUAL_ENV=$PWD/.venv PATH=$PWD/.venv/bin:$PATH
nvidia-smi                       # GPU の型番と CUDA Version を見る
nvcc --version 2>/dev/null       # システムの nvcc の版（detectron2 のビルドに使われる）
```

- GEM-X の README の PyTorch は cu126。**RTX 50 系（Blackwell・sm_120）には cu128 以上が要る**
- システムの nvcc が **CUDA 13** なら、PyTorch も cu130 にそろえる（cu128 の PyTorch は動くが、後の detectron2 のビルドで nvcc と合わずに止まる）:

```bash
uv pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cu130   # RTX 50 系 + CUDA 13 の例。GPU と CUDA に合わせて選ぶ
```

- それより前の GPU で CUDA 12 なら、README のとおり cu126（か cu128）でよい。**システムの CUDA は入れ替えない**

### 4.3 依存

```bash
uv pip install -e third_party/soma
bash scripts/install_env.sh          # 最後の detectron2 のビルドだけ CUDA 13 で失敗する（ROIAlignRotated_cuda.cu）。それより前は入る
uv pip install onnxruntime-gpu       # 人の検出（YOLOX の ONNX）に要る。install_env.sh は macOS でしか ONNX Runtime を入れない
```

- **detectron2** は推定には使わない（sam-3d-body の見せる道具だけが読む）。ビルドに失敗しても入れなくてよい
- **soma-retargeter**（ロボットへの置き換え）は要らない。サブモジュールを取るだけでよい
- `onnxruntime`（CPU 版）が先に入っていると GPU 版とぶつかる。`python -c "import onnxruntime; print(onnxruntime.get_available_providers())"` に `CUDAExecutionProvider` が出ればよい

### 4.4 重みと SOMA の体

```bash
ln -sfn ../third_party/soma/assets inputs/soma_assets     # GEM-X は SOMA の体を inputs/soma_assets から読む（このリンクが無いと推定で止まる）
.venv/bin/python -c "from gem.utils import hf_utils as h; h.download_checkpoint(); h.download_vitpose_checkpoint(); h.download_sam3d_checkpoint(); h.download_mhr_model(); h.download_soma_data()"
```

- Hugging Face の `nvidia/GEM-X` から約 6.4GB: `inputs/pretrained/gem_soma.ckpt`・`inputs/checkpoints/vitpose/vitpose.pth`・
  `inputs/checkpoints/sam-3d-body-dinov3/sam3d_body.ckpt`・`inputs/mhr_data/mhr_model.pt`・`inputs/soma_data/`
- SAM 3D Body の重みは Hugging Face で利用の同意（gated）が要ることがある。取れなければ人に `hf auth login` と同意を頼む
- 人の検出の YOLOX の重みは、初めて推定したときに `~/.cache/rtmlib/hub/checkpoints/` に自動で取ってくる

### 4.5 確かめる

```bash
.venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
ls inputs/soma_assets/SOMA_neutral.npz inputs/pretrained/gem_soma.ckpt
```

推定 1 本で GPU のメモリを最大 8GiB ほど使う。ComfyUI と同じ GPU なら、推定の前に `tools/free_vram.sh` で ComfyUI のモデルを外す（ComfyUI は止めない）。

## 5. ffmpeg・GPU

- `ffmpeg` と `ffprobe` が PATH にあること（無ければ `sudo apt install ffmpeg` などを人に頼む）
- `nvidia-smi` が動くこと（NVIDIA のドライバ。入れ替えは人に頼む）

## 6. アプリ自身

```bash
cd <アプリのフォルダ>
npm install
npm run setup:browser     # 三面図と確認用の動画を描くヘッドレスのブラウザ（chromium の headless shell）
npm run build && npm start
```

三面図・VRM の確認動画は WebGL を SwiftShader（CPU）で描くので、GPU が無くても描ける。

## 7. 設定に書いて確かめる

```bash
curl -s -X PUT $APP/api/settings -H 'Content-Type: application/json' \
  -d '{"comfyuiPath": "<アプリのフォルダ>/vendor/ComfyUI", "comfyuiUrl": "http://127.0.0.1:8188", "gemxPath": "<アプリのフォルダ>/vendor/GEM-X"}'
curl -s $APP/api/env      # ready: true になるまで、足りない項目の fix を見て直す
```

報告に書く物: 入れた物と版（ComfyUI のコミット・torch・CUDA・SageAttention・GEM-X のコミット）・取った重み・入れなかった物（detectron2 など）とその理由・人に頼みたいこと。
