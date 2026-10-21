# h3-motion-creator

VRM を 1 体読み込むと、A ポーズの三面図を自動で作る。作りたい動き（「手を振る」など）を入れて**依頼文**を作り、コピーして自分のコーディングエージェント（どれでもよい）に貼るだけで、
エージェントが MiniMax H3 の r2v（参照画像 → 動画）で動画を作り、GEM-X で体の動きを取り出して、VRM Animation（`.vrma`）にして返してくる。
できた物は確認画面で、元の動画・骨・VRM を並べて同じ時刻で再生し、どれも個別にダウンロードできる。

アプリはエージェントを呼ばない（送らない）。エージェントはアプリのローカルサーバの API を `curl` で叩いて依頼を取り、ComfyUI に直接投げ、結果を API で置く。

```
画面（人）         VRM を読み込む ─ 動きを入れて依頼文をコピー ──────────────────────── 確認画面（3 枠を同時に再生・ダウンロード）
アプリのサーバ     三面図を描く ─ 依頼を登録 ─────────────────────────── 結果を受け取る ─ 確認用の動画を焼く
エージェント                       依頼文を読む ─ H3 の指示を書いて ComfyUI へ ─ 出来を見る ─ GEM-X ─ .vrma ─ 結果を置く
GPU                                                ComfyUI（H3 r2v turbo）            GEM-X
```

## 要る物

- NVIDIA の GPU（16GB 前後。H3 と GEM-X を同じ GPU で順に使う）・ffmpeg・Node.js 20 以上
- ComfyUI（MiniMax H3 のノードが入った版）＋ ComfyUI-KJNodes・ComfyUI-Spectrum-MiniMax-H3・SageAttention・H3 のモデル（アプリには入れない。HTTP で話すだけ）
- GEM-X（NVlabs/GEM-X）とその venv・重み

足りない物は、起動して「環境チェック／設定」のタブを開けば分かる。足りない物だけを入れる**セットアップの依頼文**ができるので、それもエージェントに貼ればよい（手順は `docs/setup.md`）。

## 起動

```bash
npm install
npm run setup:browser     # 三面図と確認用の動画を描くヘッドレスのブラウザ（初めの 1 回）
npm run build
npm start                 # http://127.0.0.1:4170
```

- 開発中は `npm run dev`（サーバ 4170 と画面 5173。画面は `/api` をサーバへ渡す）
- 待ち受けは環境変数 `HOST`・`PORT`（既定 `127.0.0.1:4170`）。作業データの置き場は `DATA_DIR`（既定 `data/`）
- 認証は無い。このマシンの中だけで使う（`HOST` を外に開かない）

## 使い方

1. **環境チェック／設定**: ComfyUI のパスと URL（既定 `http://127.0.0.1:8188`）、GEM-X のパスを入れて「保存して調べる」。全部 OK になればよい。
   パスを空にすると、プロジェクトの `vendor/ComfyUI`・`vendor/GEM-X` を見る（無ければセットアップの依頼文に「vendor/ に clone して作る」と出る）
2. **依頼**: 「VRM を読み込む」で `.vrm`（0.x / 1.0）を選ぶ。利用条件（VRM のメタ情報）と三面図が出る。
   作りたい動き・尺（5・6・8・10 秒）・画角（9:16・16:9）を入れて「依頼文を作る」→「コピー」→ 自分のエージェントに貼って実行させる
3. **確認**: 依頼 1 本が 1 行。エージェントの進み具合が出る。結果が置かれるとサーバが確認用の動画を焼く。
   行を選ぶと ① 元の動画 ② 骨 ③ VRM が同じ時刻で再生される（つまみ 1 本で 3 枠そろって動く）。品質の目安（足の滑り・手首の震え・床・始めと終わりの差）も出る。
   動画・`.vrma`・骨の glb はどれも個別にダウンロードでき、複数の依頼の比較動画を 1 本にまとめることもできる

## フォルダ

| 所 | 中身 |
|---|---|
| `server/` | ローカルサーバ（Fastify・TypeScript）: API・環境チェック・依頼文・三面図と確認用の動画の段取り |
| `render/` | ヘッドレスのブラウザで開く描画のページ（三面図・VRM の確認動画。three.js ＋ three-vrm） |
| `web/` | 画面（Vite ＋ React ＋ three-vrm） |
| `tools/` | エージェントとサーバが使う道具: `h3_r2v.mjs`（ComfyUI に投げる）・`gemx.sh`・`gemx_infer.py`・`gemx2glb.py`（GEM-X → 骨の glb）・`to_vrma/`（骨の glb → .vrma）・`render_bones.py`・`make_compare.py`・`skel.py`（確認用の動画）・`free_vram.sh` |
| `workflows/minimax_h3_r2v_turbo.json` | 同梱のワークフロー（MiniMax H3 r2v turbo。ComfyUI の API 形式） |
| `docs/` | `design.md`（設計書）・`agent-guide.md`（エージェント用の手順書）・`h3-prompt.md`（H3 のプロンプトの決まり）・`setup.md`（セットアップの手順） |
| `data/` | 作業データ（git の外）: `models/<id>/`（model.vrm・threeview.png・meta.json）・`jobs/<id>/`（job.json・結果・確認用の動画）・`compare/`・`settings.json` |
| `vendor/` | パスを空にしたときに ComfyUI・GEM-X を作る所（git の外） |

## テスト

```bash
npm run typecheck
npm test
```

## ライセンス

アプリのコードは Apache License 2.0（`LICENSE`）。リポジトリに入れた他者の物の表記は `THIRD_PARTY_NOTICES.md`。
モデルの重みは同梱しない。使うモデルはそれぞれの配布元の決まりに従う。
