# エージェント用の手順書（依頼を受けてから結果を置くまで）

人が h3-motion-creator の画面で作った依頼文を、あなた（コーディングエージェント）に貼った。この手順書のとおりに進める。
アプリはあなたを呼ばない。あなたがアプリのローカルサーバの API を叩き、ComfyUI と GEM-X を自分で動かし、結果を API で置く。

- アプリのサーバ: 依頼文に書いてある URL（既定 `http://127.0.0.1:4170`）。認証なし。`curl` で叩く
- アプリのフォルダ: 依頼文に書いてある絶対パス。下の `tools/`・`workflows/`・`docs/` はそこからの相対
- 依頼の id: 依頼文の `依頼 id`（例 `wave-001`）。下では `$ID`、サーバを `$APP`、アプリのフォルダを `$ROOT` と書く

```bash
APP=http://127.0.0.1:4170; ID=wave-001; ROOT=<アプリのフォルダ>
```

## 1. 依頼を受け取る

```bash
curl -s $APP/api/jobs/$ID | python3 -m json.tool
```

返ってくる物（大事な所）:

| キー | 中身 |
|---|---|
| `motion`・`notes` | 作る動き（日本語）と注文 |
| `durationSec`・`aspect`・`width`・`height`・`fps` | 尺（秒）・画角・H3 に渡す大きさ（9:16 は 480x864、16:9 は 864x480）・24 |
| `threeview.path`・`threeview.url` | 三面図（正面・右側・後ろを横に並べた PNG。A ポーズ）。`<Picture 1>` として渡す |
| `character` | モデルのファイル名・身長・利用条件（`meta`） |
| `comfyui.url`・`comfyui.path`・`comfyui.python` | ComfyUI の URL・フォルダ・python |
| `gemx.path`・`gemx.python` | GEM-X のフォルダとその venv の python（`tools/gemx.mjs` が使う） |
| `app.workflow`・`app.tools`・`app.docs` | 同梱のワークフロー・道具・手順書の絶対パス |
| `app.workDir` | 作業用に使ってよいフォルダ（`data/jobs/$ID/work`。中間ファイルを置く） |
| `api.status`・`api.files` | 進み具合と結果を置く URL |

始める前に `GET $APP/api/env` を見て、`ready: true` か確かめる（`false` なら人に伝えて止める。セットアップは別の依頼）。

## 2. 進み具合を書く

節目ごとに書く。画面の一覧に出る:

```bash
curl -s -X POST $APP/api/jobs/$ID/status -H 'Content-Type: application/json' \
  -d '{"state": "generating", "message": "H3 を焼いている（seed 101）"}'
```

- `state`: `waiting`（依頼を作った直後）・`generating`（H3 を焼いている）・`reviewing`（出来を見ている）・`estimating`（GEM-X で推定中）・
  `converting`（.vrma に変換中）・`uploading`（結果を置いている）・`done`（できた）・`failed`（止めた）
- ほかに書ける物: `message`（ひと言）・`seed`（採用した seed）・`retries`（焼き直しの回数）・`findings`（所見。最後に書く）

## 3. H3 の指示を書く

`docs/h3-prompt.md` を読み、その決まりで英文の指示（Ref2VA の 6 節）を `app.workDir/prompt.txt` に書く。

- 三面図の見た目（髪・服・小物・画風）は、`threeview.path` の画像を自分の目で見て書く（画像を開ける道具で開く）
- 依頼の動き（`motion`・`notes`）を、始めと終わりがまっすぐ立った姿勢の段取りに直して書く。尺（`durationSec`）に収まる量にする（5 秒なら 1〜2 つの動作）
- カメラ固定・全身・1 人・無地のスタジオ・三面図は見た目の参照で画面には 1 人だけ、を必ず入れる

## 4. ComfyUI に投げる（tools/h3_r2v.mjs）

```bash
mkdir -p $ROOT/data/jobs/$ID/work && cd $ROOT
node tools/h3_r2v.mjs --job $ID --prompt-file data/jobs/$ID/work/prompt.txt --seed 101 --out data/jobs/$ID/work/take-s101.mp4
```

- 三面図・尺・大きさ・ComfyUI の URL は `GET /api/jobs/$ID` から取る（`--image`・`--duration`・`--width`・`--height`・`--comfy` で上書きできる）
- 5 秒・480x864 で 1〜2 分ほど（GPU による）。ComfyUI の初めの 1 本はモデルの読み込みで長い
- 終わりに `[h3_r2v] {"seed": …, "promptId": …, "out": …}` が出る

道具を使わずに投げるとき（同じことを手でする）:

1. 参照画像を上げる: `curl -s -F image=@<threeview.png> -F overwrite=true -F subfolder=h3-motion-creator $COMFY/upload/image` → `{"name", "subfolder"}`
2. `workflows/minimax_h3_r2v_turbo.json`（API 形式のグラフ）を読み、次を差し込む:

| ノード | 入力 | 入れる物 |
|---|---|---|
| `137`（LoadImage） | `image` | 上げた画像（`<subfolder>/<name>`）。`<Picture 1>` になる |
| `138`（PrimitiveStringMultiline） | `value` | 英文の指示 |
| `132`（PrimitiveFloat） | `value` | 尺（秒）。`131`（ComfyMathExpression）が 24fps の 17k+5 のコマ数にする（5 秒 = 124 コマ） |
| `136`（MiniMaxH3ReferenceToVideo） | `width`・`height` | 数で上書きする（`115` の ResolutionSelector からのつなぎを置き換える。32 の倍数・0.4MP） |
| `129`（RandomNoise） | `noise_seed` | seed |
| `92`（SaveVideo） | `filename_prefix` | 出力の名前（例 `h3-motion-creator/$ID-s101`） |

3. 参照画像 1 枚だけなので、雛形の参照動画・その音声・参照音声のノード `140`・`141`・`142` を消し、`136` の入力
   `ref_videos.ref_video_0`・`ref_video_audios.ref_video_audio_0`・`ref_audios.ref_audio_0` を消す（残すと、無いファイルを読もうとして止まる）
4. `POST $COMFY/prompt` に `{"prompt": <グラフ>, "client_id": "…"}` → `prompt_id`。`GET $COMFY/history/<prompt_id>` を待ち、
   `outputs["92"]` のファイルを `GET $COMFY/view?filename=…&subfolder=…&type=output` で取る

ほかの値（サンプラー・4 ステップ・LoRA・高速化のノード）は変えない。

## 5. 出来を見る・焼き直す

できた動画のコマを並べて見る（自分の目で）:

```bash
ffmpeg -v error -i data/jobs/$ID/work/take-s101.mp4 -vf "fps=2,scale=240:-2,tile=6x2" -frames:v 1 -y data/jobs/$ID/work/take-s101-sheet.png
```

**焼き直す（seed を変えてもう一度。最大 3 回くらい）**のは:

- 人が 2 人以上いる・三面図がそのまま映る（3 人並ぶ）・画面の中に枠や文字が出る
- 全身が切れる（頭か足が画の外へ）・カメラが動く（ズーム・パン・カット）
- 手足の数が違う・手足が体や小物を突き抜ける・体がねじれて溶ける
- 動きが依頼と違う（振っていない・逆の動き）・ほとんど動かない・始めか終わりがまっすぐ立っていない

小さな崩れ（指の形・袖の揺れ・顔の細部）は焼き直さなくてよい（GEM-X は全身の大きな動きを取る。指の形はほとんど取れない）。
プロンプトの書き方が原因なら（全員が同じ崩れ）、seed より先に指示を直す。採用した物を `source.mp4` にする:

```bash
cp data/jobs/$ID/work/take-s101.mp4 data/jobs/$ID/work/source.mp4
```

## 6. GEM-X で骨を取る（tools/gemx.mjs）

GEM-X は GPU のメモリを最大 8GiB ほど使う。ComfyUI が H3 のモデルを載せたままだと足りないので、空きを見て、足りなければ外す（ComfyUI は止めない）:

```bash
nvidia-smi --query-gpu=memory.used,memory.free --format=csv
node tools/free_vram.mjs     # 任意。ComfyUI の /free を呼ぶ
node tools/gemx.mjs data/jobs/$ID/work/source.mp4 data/jobs/$ID/work/gemx   # → bones.glb・stats.json
```

- 推定は 5 秒の動画で 1 分ほど。2D の関節を重ねた動画（`gemx/gemx-out/source/0_kp2d77_overlay.mp4`）でずれを見られる
- 前の向き: 既定は始めの 0.5 秒の向き（`--facing start`）。走り出す・向きを変える動きは `--facing ends`（前後の立っている所）か `--facing mean` で作り直す
  （推定は飛ばされるので速い）
- 床: 既定は 1 秒の窓で上下のずれを追う。転がる・寝る動きは `--floor_window 0.3`

`stats.json` の品質の目安（`footSlide`・`lowestPointCm`・`jitterAccMedian`）を見る。目安:

| 目安 | よい | 手を入れる |
|---|---|---|
| 足の滑り（`footSlide.*.medianCmPerSec`） | 3 cm/秒 以下 | 8 以上: その場の動きなら `--in-place`、または H3 を焼き直す |
| 床（`lowestPointCm.median`） | ±1.5 cm | 4 以上浮く・沈む: `--floor` を見直す |
| 手首の震え（`jitterAccMedian.LeftHand`・`RightHand`） | 3 m/s² 以下 | 8 以上: `--smooth 0.08`〜`0.1` |

## 7. .vrma にする（tools/to_vrma/to_vrma.mjs）

```bash
node tools/to_vrma/to_vrma.mjs --glb data/jobs/$ID/work/gemx/bones.glb --out data/jobs/$ID/work/motion.vrma [オプション]
```

ループ・その場・切り出し・向きは、動きを見て決めてよい:

| したいこと | オプション |
|---|---|
| 1 回の身ぶり（手を振る・お辞儀など。既定） | なし。始めと終わりの両足の真ん中が原点に来る |
| 前後の待機を切る | `--from 0.4 --to 4.6`（元の動画の秒。始めと終わりの立っている所は 0.3 秒くらい残す） |
| 繰り返す動き（走る・歩く・踊る） | 1 周期を `--from`・`--to` で切り出して `--loop`（`--blend 0.3〜0.5`。つなぎ目を重ねる秒）。足の位置がそろう所で切る |
| 進む分を消す | `--in-place` |
| 震えをならす | `--smooth 0.08`（既定 0.05） |
| 上半身だけ使う | `--lower-body neutral` |
| 左右を入れ替える | `--mirror` |

終わりに `[to_vrma] {"startEndDeg": …, "startEndHipsCm": …}` が出る。1 回の身ぶりで始めと終わりの差が大きい（30° 以上）ときは、
始めか終わりで立っていない。`--from`・`--to` を見直すか、H3 を焼き直す。`--from`・`--loop` を使うと、.vrma に元の動画のどこから始まるかが入り、
確認画面と確認用の動画はそれに合わせて時刻をそろえる。

## 8. 結果を置く

4 つとも置く（`--data-binary @ファイル`）。置かれた物はサーバが形を確かめ、そろったら確認用の動画（骨・VRM・3 枠の比較）を自分で焼く:

```bash
W=data/jobs/$ID/work
curl -s -X POST $APP/api/jobs/$ID/status -H 'Content-Type: application/json' -d '{"state": "uploading"}'
curl -s -X PUT --data-binary @$W/source.mp4        $APP/api/jobs/$ID/files/source.mp4
curl -s -X PUT --data-binary @$W/gemx/bones.glb    $APP/api/jobs/$ID/files/bones.glb
curl -s -X PUT --data-binary @$W/gemx/stats.json   $APP/api/jobs/$ID/files/stats.json
curl -s -X PUT --data-binary @$W/motion.vrma       $APP/api/jobs/$ID/files/motion.vrma
```

- `source.mp4` は H3 の動画そのまま（24 コマ/秒。GEM-X に入れたのと同じ物）
- 形が違えば 400 と理由が返る（mp4 でない・glb にアニメーションが無い・.vrma に `VRMC_vrm_animation` が無い・JSON でない）
- 確認用の動画は 1〜2 分で焼ける。`GET $APP/api/jobs/$ID` の `proofs.state` が `done` になり、`files` に `bones.mp4`・`vrm.mp4`・`compare.mp4` が並ぶ。
  `failed` なら `proofs.error` を見る（焼き直しは `POST $APP/api/jobs/$ID/proofs`）

最後に `done` と所見を書く:

```bash
curl -s -X POST $APP/api/jobs/$ID/status -H 'Content-Type: application/json' -d '{
  "state": "done", "seed": 101, "retries": 1,
  "message": "できた（1 回目は手が帽子に刺さったので焼き直し）",
  "findings": "足の滑り 1.2 cm/秒・手首の震え 1.0 m/s²・床 0.4 cm。右手で 3 回振る。始めと終わりはまっすぐ立つ。ループ・その場はしていない（1 回の身ぶり）。手は顔の横で止まる"
}'
```

所見に書く物: 使った seed・焼き直しの回数と理由・足の滑り・震え・手の位置（体や小物に入っていないか）・ループやその場にしたか・切り出した所。

## 9. 止めるとき

ComfyUI につながらない・GEM-X が失敗する・3 回焼き直しても崩れる、などで進めないときは、`failed` と理由を書いて人に伝える:

```bash
curl -s -X POST $APP/api/jobs/$ID/status -H 'Content-Type: application/json' -d '{"state": "failed", "message": "…"}'
```

## 10. してはいけないこと

- ComfyUI を止める・再起動する（ほかの人が使っている。VRAM は `node tools/free_vram.mjs` で空ける）
- 同梱のワークフローの JSON・アプリのファイルを書きかえる（作業は `data/jobs/$ID/work/` で）
- モデルの利用条件（`character.meta`）に合わない使い方（作者だけが使えるモデルを、許可の無い人のために動かすなど）。気になれば人に確かめる
