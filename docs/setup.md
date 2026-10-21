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

確かめるコマンド（アプリのフォルダで）:

```
node -e "fetch('http://127.0.0.1:4170/api/env').then(r => r.json()).then(d => { console.log('ready', d.ready); for (const i of d.items) console.log(i.state, i.label, '|', i.detail) })"
```

下の `<ComfyUI の python>`・`<GEM-X の python>` は、それぞれの venv の python（`venv/bin/python`・`.venv/bin/python`。Windows は `venv\Scripts\python.exe`・`.venv\Scripts\python.exe`）。
環境チェックの SageAttention・GEM-X の venv の項目に、実際に使った python が出る。

## 2. ComfyUI（パスが空で、vendor/ComfyUI に作るとき）

URL（既定 `http://127.0.0.1:8188`）で別の ComfyUI がもう動いているなら、新しく作らず、そのフォルダを人に聞いて設定に書く（同じポートで 2 つは動かせない）。

### 2.1 本体と venv

```
cd <アプリのフォルダ>
git clone https://github.com/Comfy-Org/ComfyUI vendor/ComfyUI
cd vendor/ComfyUI
uv venv venv --python 3.12
# PyTorch は GPU に合う CUDA の版で（nvidia-smi の CUDA Version 以下）。RTX 50 系（Blackwell・sm_120）は cu128 以上
uv pip install --python <ComfyUI の python> torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
uv pip install --python <ComfyUI の python> -r requirements.txt
```

MiniMax H3 のノード（`MiniMaxH3ReferenceToVideo`・`MiniMaxH3SigmaShift`）と `BlockSparseAttention` は ComfyUI の本体に入っている（`comfy_extras/nodes_minimax_h3.py`・`nodes_sparse_attention.py`）。
既にある ComfyUI にこれらが無いときは、本体が古い。上げるかは人に確かめる。

### 2.2 カスタムノード

```
cd <ComfyUI のフォルダ>/custom_nodes
git clone https://github.com/kijai/ComfyUI-KJNodes                 # PathchSageAttentionKJ・MiniMaxH3MemoryEfficientSageAttentionPatch
git clone https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3     # SpectrumApplyMiniMaxH3
<ComfyUI の python> -m pip install -r ComfyUI-KJNodes/requirements.txt
<ComfyUI の python> -m pip install -r ComfyUI-Spectrum-MiniMax-H3/requirements.txt     # requirements.txt があるときだけ
```

### 2.3 SageAttention

ComfyUI の venv に入れる。GPU・torch・CUDA の版に合う物を選ぶ（合わない物を入れると ComfyUI が起動しなくなるので、入れる前に torch の版を見る）:

```
<ComfyUI の python> -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.get_device_capability())"
<ComfyUI の python> -m pip install sageattention       # 合う wheel が無ければ https://github.com/thu-ml/SageAttention をソースからビルド
<ComfyUI の python> -c "import sageattention"           # 環境チェックはこれを見る
```

### 2.4 起動

```
cd <ComfyUI のフォルダ>
<ComfyUI の python> main.py --listen 127.0.0.1 --port 8188
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
| `models/vae/` | `minimax_h3_video_vae_int8_convrot.safetensors`（映像の VAE） | Hugging Face `Kijai/MiniMax-H3-experimental` |
| `models/vae/` | `minimax_h3_audio_vae_fp32.safetensors`（音声の VAE） | Hugging Face `Comfy-Org/MiniMax-H3`（`vae/`） |
| `models/text_encoders/` | `qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors` | Hugging Face `Momoking/Qwen3-VL-32B-Heretic-MiniMax-H3-NVFP4` |

```
hf download Kijai/MiniMax-H3-experimental minimax_h3_fl2va_pruned_w4a8_mixed.safetensors --local-dir <作業用のフォルダ>   # 例。取った物を上の所へ移す
```

- 合わせて 35GB ほど。ディスクの空きを先に見る

## 4. GEM-X（パスが空で、vendor/GEM-X に作るとき）

GEM-X（NVlabs/GEM-X）は動画から体の 77 関節（体・指）と腰の軌跡を推定する。アプリは GEM-X のファイルを変えず、その venv の python で `tools/gemx_infer.py`・`tools/gemx2glb.py`・`tools/render_bones.py`・`tools/make_compare.py` を動かす。

### 4.1 clone（詰まり所が 2 つ）

```
cd <アプリのフォルダ>
git clone --recursive https://github.com/NVlabs/GEM-X vendor/GEM-X     # soma-retargeter のサブモジュールは SSH の URL（git@github.com:）なので、鍵が無いとここで止まる
cd vendor/GEM-X
git checkout 3299255   # 重み（§4.4 の Hugging Face の版）と合うコードの版に固定する
git -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init --recursive   # https に読み替えて取り直す
git -C third_party/sam-3d-body checkout -f HEAD                        # 1 回目の clone が途中で止まると、中身が空のまま残る
git -C third_party/soma lfs pull                                       # SOMA の体の形（約 800MB。git-lfs が要る）
```

### 4.2 venv と PyTorch（CUDA の版に注意）

GEM-X のフォルダで動かす（`uv pip` は今のフォルダの `.venv` に入れる）:

```
uv venv .venv --python 3.12
nvidia-smi                       # GPU の型番と CUDA Version を見る
nvcc --version                   # システムの nvcc の版（detectron2 のビルドに使われる。無ければ出ない）
```

- GEM-X の README の PyTorch は cu126。**RTX 50 系（Blackwell・sm_120）には cu128 以上が要る**
- システムの nvcc が **CUDA 13** なら、PyTorch も cu130 にそろえる（cu128 の PyTorch は動くが、後の detectron2 のビルドで nvcc と合わずに止まる）:

```
uv pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cu130   # RTX 50 系 + CUDA 13 の例。GPU と CUDA に合わせて選ぶ
```

- それより前の GPU で CUDA 12 なら、README のとおり cu126（か cu128）でよい。**システムの CUDA は入れ替えない**

### 4.3 依存

```
uv pip install -e third_party/soma
bash scripts/install_env.sh          # 最後の detectron2 のビルドだけ CUDA 13 で失敗する（ROIAlignRotated_cuda.cu）。それより前は入る
uv pip install onnxruntime-gpu       # 人の検出（YOLOX の ONNX）に要る。install_env.sh は macOS でしか ONNX Runtime を入れない
```

- **detectron2** は推定には使わない（sam-3d-body の見せる道具だけが読む）。ビルドに失敗しても入れなくてよい
- **soma-retargeter**（ロボットへの置き換え）は要らない。サブモジュールを取るだけでよい
- `onnxruntime`（CPU 版）が先に入っていると GPU 版とぶつかる。`<GEM-X の python> -c "import onnxruntime; print(onnxruntime.get_available_providers())"` に `CUDAExecutionProvider` が出ればよい

### 4.4 重みと SOMA の体

```
node -e "require('fs').symlinkSync(require('path').resolve('third_party/soma/assets'), 'inputs/soma_assets', 'junction')"   # GEM-X は SOMA の体を inputs/soma_assets から読む（このリンクが無いと推定で止まる。既にあれば要らない）
<GEM-X の python> -c "import functools, huggingface_hub as hh; hh.hf_hub_download = functools.partial(hh.hf_hub_download, revision='5b9a69d5ed4713ac4ba2a63b335e66db87279a3e'); from gem.utils import hf_utils as h; h.download_checkpoint(); h.download_vitpose_checkpoint(); h.download_sam3d_checkpoint(); h.download_mhr_model(); h.download_soma_data()"
```

- Hugging Face の `nvidia/GEM-X` の版 `5b9a69d5ed47`（コードの版 `3299255` に合う重み。main は別の版の重みに入れ替わっている）から約 6.4GB: `inputs/pretrained/gem_soma.ckpt`・`inputs/checkpoints/vitpose/vitpose.pth`・
  `inputs/checkpoints/sam-3d-body-dinov3/sam3d_body.ckpt`・`inputs/mhr_data/mhr_model.pt`・`inputs/soma_data/`
- SAM 3D Body の重みは Hugging Face で利用の同意（gated）が要ることがある。取れなければ人に `hf auth login` と同意を頼む
- 人の検出の YOLOX の重みは、初めて推定したときに `~/.cache/rtmlib/hub/checkpoints/` に自動で取ってくる

### 4.5 確かめる

```
<GEM-X の python> -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

重みがそろったかは、環境チェックの「GEM-X の重み」で見る。

推定 1 本で GPU のメモリを最大 8GiB ほど使う。ComfyUI と同じ GPU なら、推定の前に `node tools/free_vram.mjs` で ComfyUI のモデルを外す（ComfyUI は止めない）。

## 5. ffmpeg・GPU

- `ffmpeg` と `ffprobe` が PATH にあること（入れ方の例は環境チェックの直し方に出る。sudo などの管理者の権限が要るなら人に頼む）
- `nvidia-smi` が動くこと（NVIDIA のドライバ。入れ替えは人に頼む）

## 6. アプリ自身

```
cd <アプリのフォルダ>
npm install
npm run setup:browser     # 三面図と確認用の動画を描くヘッドレスのブラウザ（chromium の headless shell）
npm run build
npm start
```

三面図・VRM の確認動画は WebGL を SwiftShader（CPU）で描くので、GPU が無くても描ける。

## 7. 設定に書いて確かめる

```
node -e "fetch('http://127.0.0.1:4170/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comfyuiPath: process.argv[1], gemxPath: process.argv[2] }) }).then(r => r.text()).then(console.log)" <ComfyUI のフォルダ> <GEM-X のフォルダ>
```

python が venv・.venv の外（conda など）にあるときは、同じように `comfyuiPython`・`gemxPython` にその python のファイルのパスを書く（空なら自動で探す）。
§1 の確かめるコマンドで `ready true` になるまで、足りない項目の直し方を見て直す。

報告に書く物: 入れた物と版（ComfyUI のコミット・torch・CUDA・SageAttention・GEM-X のコミット）・取った重み・入れなかった物（detectron2 など）とその理由・人に頼みたいこと。

## 8. Google Colab のとき

`colab/h3-motion-creator.ipynb` が、Colab の実行環境（GPU つきの Linux）の中に上の一式を入れて起動し、設定まで書く。人はセルを上から実行し、エージェントは Colab のターミナルで動かす。

- 置き場: アプリ `/content/h3-motion-creator`・ComfyUI `/content/ComfyUI`（venv は `venv/`）・GEM-X `/content/GEM-X`（venv は `.venv/`）。作業データ（`DATA_DIR`）は Google ドライブの `MyDrive/h3-motion-creator/data`。アプリの URL は `http://127.0.0.1:4170` のまま
- venv は `--system-site-packages` で作り、Colab に入っている PyTorch を使う（GPU に合わないときだけ venv に cu128 / cu130 の物を入れる）。PyTorch の版は `<venv>/h3-constraints.txt` で固定している。足すときは `<python> -m pip install -c <venv>/h3-constraints.txt …` で、PyTorch を入れ替えない
- SageAttention はソースからビルドした物（wheel はドライブの `MyDrive/h3-motion-creator/cache/` に残る）
- 足りない物が出たら、まずノートブックのセットアップのセル（2.）をもう一度実行するよう人に頼む。入っている物は飛ばして、足りない物だけ入れ直す（ランタイムを再起動したときは 1. → 2. → 3.）
- `/content` の下はセッションを止めると消える（ドライブの作業データは残る）
