# h3-motion-creator 設計書

## 目次

1. 目的
2. 全体の流れ
3. 構成要素と受け持ち
4. 画面
5. ローカルサーバの API
6. データの置き場と形
7. 依頼文とセットアップの依頼文
8. 三面図の作り方
9. H3 r2v turbo の投げ方
10. GEM-X の推定と骨の glb
11. 骨の glb から .vrma への変換
12. 確認用の動画の作り方
13. 環境チェックの判定
14. ライセンスの方針

---

## 1. 目的

VRM のキャラクター 1 体と、言葉で書いた動き（「手を振る」「走る」など）から、そのキャラクターに使える VRM Animation（`.vrma`）を作る。

- VRM を読み込むと、アプリが A ポーズの三面図（正面・右側・後ろを 1 枚に並べた画）をプログラムで作る
- 動画は MiniMax H3 の参照モード（r2v。三面図を参照画像にする）で作り、その動画から GEM-X で体の動きを取り出し、`.vrma` にする
- 動画づくりと推定は、人が使っているコーディングエージェント（どれでもよい）が行う。アプリはエージェントを呼ばない・送らない。
  人がアプリの画面で作った**依頼文**をコピーしてエージェントに貼り、エージェントがアプリのローカルサーバの API を叩いて依頼を取り、結果を置く
- できた物は確認画面で、元の動画・骨・VRM の 3 枠を同じ時刻で同時に再生し、どれも個別にダウンロードできる

作らない物: 焼き直しの版の管理（1 つの依頼に置ける結果は 1 組。置き直すと上書き）、エージェントの呼び出し、ComfyUI の同梱。

## 2. 全体の流れ

| 段 | 画面（人） | アプリのサーバ（プログラム） | エージェント | GPU |
|---|---|---|---|---|
| 0 起動 | 最初の設定（ComfyUI のパスと URL・GEM-X のパス） | 環境チェック。足りなければセットアップの依頼文を作る | （足りない時）セットアップの依頼文を読んで入れる | |
| 1 VRM と三面図 | VRM（0.x / 1.0）を選ぶ。利用条件を見る | VRM を登録し、ヘッドレスのブラウザで A ポーズの三面図を描く | | |
| 2 依頼文 | 動き・尺・画角を入れて依頼文をコピーし、エージェントに貼る | 依頼に id を振り、API で渡せるようにする | | |
| 3 動画を作る | | | 依頼を API で取り、H3 の指示を書き、同梱のワークフローで ComfyUI に直接投げる。コマを見て崩れていれば焼き直す | ComfyUI（H3 r2v turbo） |
| 4 骨を取る | | | GEM-X で推定し、骨の glb と品質の目安を作り、`.vrma` にする。ループ・その場・向きは動きを見て決める | GEM-X |
| 5 確かめる | 確認画面で 3 枠を同時に再生・ダウンロード | 結果が置かれたら、確認用の動画（骨・VRM・3 枠の比較）を焼く | 進み具合・結果・所見を API で置く | |

## 3. 構成要素と受け持ち

| 所（リポジトリの中） | 受け持ち |
|---|---|
| `server/` | ローカルサーバ（Node・Fastify・TypeScript。既定 `127.0.0.1:4170`）。API・設定・環境チェック・依頼文・作業データの読み書き・三面図と確認用の動画の段取り |
| `server/shared.ts` | 画面とサーバで共有する型と定数（依頼の状態・結果のファイルの名前・尺の選択肢・画角ごとの大きさ） |
| `render/threeview.html`・`render/vrm-video.html` | ヘッドレスのブラウザ（Playwright の chromium。WebGL）で開く描画のページ。three.js ＋ three-vrm ＋ three-vrm-animation |
| `web/` | 画面（Vite ＋ React ＋ TypeScript ＋ three.js ＋ three-vrm ＋ three-vrm-animation）。ビルドした物はサーバが配る |
| `workflows/minimax_h3_r2v_turbo.json` | 同梱のワークフロー（ComfyUI の API 形式のグラフ） |
| `tools/h3_r2v.mjs` | ワークフローに入力を差し込んで ComfyUI に投げ、できた動画を取る（エージェントが使う） |
| `tools/gemx.sh`・`tools/gemx_infer.py`・`tools/gemx2glb.py` | GEM-X の推定 → 骨の glb・品質の目安（エージェントが使う。Python は GEM-X の venv で動かす） |
| `tools/to_vrma/` | 骨の glb → `.vrma`（Node。エージェントが使う） |
| `tools/skel.py`・`tools/render_bones.py`・`tools/make_compare.py` | 確認用の骨の動画・3 枠の比較の動画（サーバが GEM-X の venv の python で呼ぶ） |
| `tools/free_vram.sh` | ComfyUI を止めずに、読み込み済みのモデルを GPU のメモリから外す（任意） |
| `docs/agent-guide.md`・`docs/h3-prompt.md`・`docs/setup.md` | エージェント用の手順書・H3 のプロンプトの決まり・セットアップの手順 |
| `data/` | 作業データ（git の外） |
| `vendor/` | 設定のパスが空のときに ComfyUI・GEM-X を作る所（git の外） |
| 外: ComfyUI | 設定のパスと URL。アプリは HTTP で話すだけ（同梱しない） |
| 外: GEM-X | 設定のパス。アプリの Python の道具がその venv で GEM-X の関数を呼ぶ（GEM-X のファイルは変えない） |

## 4. 画面

タブは 3 つ。どの画面も幅の狭い画面では 1 列に並ぶ。下の端に、動画の生成に MiniMax H3 を使うこと・モデルの重みを同梱しないことを出す。

### 4.1 環境チェック／設定

- 設定の欄: ComfyUI のパス・ComfyUI の URL（既定 `http://127.0.0.1:8188`）・GEM-X のパス。それぞれの下に実際に見る所（空なら `vendor/ComfyUI`・`vendor/GEM-X`）を出す
- ComfyUI のパスと GEM-X のパスの欄の横に「フォルダを選ぶ」。押すとフォルダを選ぶダイアログ（モーダル）が開く。
  ブラウザの標準のフォルダの選択（`input` の `webkitdirectory`・`showDirectoryPicker`）は絶対パスが取れず、OS ごとのネイティブのダイアログは OS で動きが変わるので使わない。
  サーバのフォルダを見て回る API（`GET /api/fs/dirs`）を画面の中のダイアログで見せる
  - 開く所: 欄の値（空なら実際に見る所。`vendor/` の既定）。無ければあるところまで上へたどる。どれも開けなければホーム
  - 上: パンくず（押すとそのフォルダへ）・パスを直接入れて移動（`~` も使える）・「上へ」・「ホーム」・ルート（Windows ならドライブごと）・「隠しフォルダも出す」（既定は出さない。隠れている数を出す）
  - 一覧: 中のフォルダだけ（名前順）。クリックで選ぶ・ダブルクリックで中へ。シンボリックリンクのフォルダには「リンク」と出し、中へもたどれる。
    欄に合わせて、ComfyUI らしいフォルダ（`main.py` と `custom_nodes/` がある）・GEM-X らしいフォルダ（`.venv` と `scripts/demo/` がある）に小さな印を出す。今のフォルダが当てはまればパンくずの横にも出す
  - 下: 選ぶフォルダ（一覧で選んだ物、選んでいなければ今のフォルダ）と印・「やめる」・「このフォルダを選ぶ」
  - キーボード: 一覧で ↑↓ で選ぶ・→ で中へ・← か Backspace で上へ・Enter で決定。パスの欄では Enter で移動。Esc でやめる
  - 読めないフォルダ（無い・フォルダでない・権限が無い）はダイアログの中にエラーの文を出し、今の一覧はそのまま
  - 決めると欄に入り、「保存して調べる」と同じ流れ（`PUT /api/settings` → `GET /api/env`）で保存して調べ直す
- 「保存して調べる」（`PUT /api/settings` → `GET /api/env`）・「もう一度調べる」
- 環境チェックの一覧: 項目ごとに 1 行（印 ✓ / ✕、名前、見た物・見つかった物、OK / 無い）。項目は §13
- 足りない物があれば、セットアップの依頼文（§7.2）とコピーのボタン。全部 OK なら依頼文は出さない

### 4.2 依頼

左: VRM

- 読み込んだ VRM の選択と「VRM を読み込む」（`.vrm` を選ぶ → `POST /api/models`）
- VRM の版・名前・作者・身長（三面図を描いたときの全身の高さ）
- 利用条件（VRM のメタ情報。§6.2）: 使ってよい人・商用・改変・再配布・暴力と性的な表現・クレジット・ライセンスの URL。注意（作者のみ・商用の範囲・改変不可・クレジットが要る）があれば開いて出す
- 三面図（サーバが作る。作っている間は「作っています…」。できるまで 2 秒ごとに見に行く）

右: 依頼

- 作りたい動き（自由に書ける。よく使う動きを候補に出す）・尺（5・6・8・10 秒）・画角（9:16・16:9）・注文（任意）
- 「依頼文を作る」（三面図ができてから押せる）→ `POST /api/jobs` → 依頼文（§7.1）とコピーのボタン

### 4.3 確認

左: 一覧（依頼 1 本 = 1 行。3 秒ごとに読み直す）

- 列: まとめる（チェック。比較の動画ができた依頼だけ選べる）・動き と id・尺（`.vrma` ができていればその長さ）・状態（エージェントが書いた状態と最新のひと言）
- 「選んだ物の比較動画をまとめて 1 本に」→ `POST /api/compare` → ダウンロードのリンク

右: 選んだ依頼

- 見出し: 動き・id・尺・画角・状態・確認用の動画の状態。「依頼文」で依頼文をもう一度出せる
- 3 枠: ① 元の動画（`source.mp4` を video で）・② 骨（`bones.mp4` を video で）・③ VRM（画面の中で three-vrm が VRM に `motion.vrma` を載せて描く）
- 時刻をそろえる: 主の時計は画面の時刻 `t`（元の動画の秒）。再生中は `t` を進め、video の時刻が `t` から 0.08 秒より離れたら合わせる。止めているときは `t` に合わせて止める。
  ③ は `.vrma` の時刻 = `t − sourceStartSec`（`.vrma` の外は始め・終わりの姿勢で止める。§6.5）。つまみ 1 本で 3 枠とも動く。長さは ① と ② の短いほう
- 品質の目安（§6.4 から）: 足の滑り（cm/秒）・手首の震え（m/s²）・床（いちばん低い所の中央値、cm）・始めと終わりの差（度）を、よい / 中 / 悪いの色で。seed・焼き直しの回数・ループ・その場・元の動画のどこからか
- エージェントの所見・ダウンロード（元の動画・骨の動画・VRM の動画・比較の動画・`.vrma`・骨の glb・品質の目安の json。あるものだけ）・進み具合の記録
- 確認用の動画が失敗したら、理由と「焼き直す」（`POST /api/jobs/{id}/proofs`）

## 5. ローカルサーバの API

認証なし。`127.0.0.1` だけで待ち受ける（ほかの PC からは叩けない）。エラーは `{"error": "…"}` と 400 / 404 / 500。バイナリは本文にそのまま入れる（`curl --data-binary @ファイル`。Content-Type は問わない）。

| API | 使う側 | 中身 |
|---|---|---|
| `GET /api/env` | 画面 | 環境チェックを走らせて結果を返す（`EnvReport`。§13）。`?cached=1` なら最後の結果 |
| `GET /api/setup-request` | 画面 | `{text, env}`。`text` は足りない物だけを入れるセットアップの依頼文（全部 OK なら `null`） |
| `GET /api/settings` | 画面・道具 | 設定と、実際に見るパス（`resolved`: `comfyuiPath`・`gemxPath`・`gemxPython`・パスが設定から来たか） |
| `PUT /api/settings` | 画面・エージェント | `{comfyuiPath?, comfyuiUrl?, gemxPath?}` を書く |
| `GET /api/fs/dirs?path=<絶対パス>&hidden=1` | 画面 | フォルダを選ぶダイアログ（§4.1）が読む。下の表 |
| `GET /api/models` | 画面 | 登録した VRM の一覧（`meta.json` の並び。新しい順） |
| `POST /api/models?name=<ファイル名>` | 画面 | 本文 = VRM。メタ情報を読んで登録し（VRM でなければ 400）、三面図を描き始める。201 と `meta.json` |
| `GET /api/models/{id}` | 画面 | `meta.json` |
| `POST /api/models/{id}/threeview` | 画面 | 三面図を描き直す |
| `GET /api/models/{id}/model.vrm`・`…/threeview.png` | 画面・描画のページ・エージェント | VRM・三面図 |
| `POST /api/jobs` | 画面 | `{modelId, motion, durationSec, aspect, notes?}` で依頼を作る。201 と `{job, text}`（`text` = 依頼文）。尺・画角・モデル・動きが違えば 400 |
| `GET /api/jobs` | 画面 | 依頼の一覧（新しい順） |
| `GET /api/jobs/{id}` | エージェント | 依頼の中身（§6.3 の `job.json` ＋ 下の表） |
| `GET /api/jobs/{id}/request-text` | 画面 | `{text}`（依頼文） |
| `POST /api/jobs/{id}/status` | エージェント | `{state?, message?, seed?, retries?, findings?}`。進み具合と所見。記録に足し、一覧に出る |
| `PUT /api/jobs/{id}/files/{name}` | エージェント | 結果を置く（`source.mp4`・`bones.glb`・`motion.vrma`・`stats.json`）。形を確かめ（§6.6）、品質の目安をまとめ直し、`source.mp4`・`bones.glb`・`motion.vrma` がそろえば確認用の動画を焼く予約をする |
| `GET /api/jobs/{id}/files/{name}` | 画面 | 結果と確認用の動画（`bones.mp4`・`vrm.mp4`・`compare.mp4`）。`?download=1` で `<id>-<name>` の名前のダウンロード。Range に応える（動画のシーク） |
| `POST /api/jobs/{id}/proofs` | 画面・エージェント | 確認用の動画を焼き直す |
| `POST /api/compare` | 画面 | `{ids: [...]}` の依頼の `compare.mp4` をこの順につないで 1 本にする。`{name, url}` |
| `GET /api/compare/{name}` | 画面 | まとめた比較の動画（ダウンロード） |

`GET /api/jobs/{id}` が `job.json` に足す物（エージェントが要る物を 1 回で取れるように）:

| キー | 中身 |
|---|---|
| `width`・`height`・`fps` | H3 に渡す大きさ（9:16 は 480x864、16:9 は 864x480。0.4MP・32 の倍数）・24 |
| `character` | `modelId`・`fileName`・`name`・`heightM`・`vrmPath`（絶対パス）・`meta`（利用条件） |
| `threeview` | `state`・`url`・`path`（絶対パス）・`width`・`height`・`layout`（並び方の説明） |
| `comfyui` | `url`・`path`（実際に見るパス） |
| `gemx` | `path`・`python`（GEM-X の venv の python） |
| `app` | `root`・`serverUrl`・`workflow`・`docs`（`agentGuide`・`h3Prompt`）・`tools`（`h3R2v`・`freeVram`・`gemx`・`gemxInfer`・`gemx2glb`・`toVrma`）・`workDir`（`data/jobs/<id>/work`。エージェントの作業用） |
| `api` | `status`・`files`（結果を置く URL）・`proofs`（確認用の動画の URL） |

`GET /api/fs/dirs` はサーバのフォルダを見て回る。読むだけで、フォルダやファイルを作る・消す・書くことはしない。

- `path`: 絶対パス。省略・空・`~` ならホーム。`~/…` はホームからに広げる。相対パスは 400
- `hidden`: `1` なら隠しフォルダ（名前が `.` で始まる）も出す。既定は出さない
- 答えは `DirListing`（`server/shared.ts`）: `{path, parent, sep, home, roots, crumbs, hints, dirs, hiddenCount, truncated}`
  - `path`: 今のフォルダ（絶対パスにそろえた物）・`parent`: 一つ上（ルートなら `null`）・`sep`: パスの区切り
  - `home`: ホーム・`roots`: ルートの並び（Windows ならあるドライブ、ほかは `/`）・`crumbs`: パンくず（`{name, path}` の並び。ルートから今のフォルダまで）
  - `dirs`: 中のフォルダだけ（`{name, path, link?, hints}` の並び。名前順。ファイル・ファイルへのリンク・切れたリンクは入らない）。シンボリックリンクのフォルダは `link: true` で入る。多すぎるときは 2000 個で切り、`truncated: true`
  - `hints`（今のフォルダと `dirs` のそれぞれ）: `comfyui`（`main.py` と `custom_nodes/` がある）・`gemx`（`.venv` と `scripts/demo/` がある）の並び。どれを出すかは画面が欄に合わせて決める
  - `hiddenCount`: 隠しフォルダの数（`hidden` に関わらず数える）
- 読めないときはエラーの文: 無い 404（`フォルダがありません: …`）・フォルダでない 400・読む権限が無い 400（`このフォルダは読めません（読む権限がありません）: …`）
- 接続がこの PC の中（ループバック）からでなければ 403。待ち受けを変えても、フォルダの一覧は外へ出さない

同じ Fastify は、ほかに `/`（ビルドした画面）・`/render/*`（描画のページ）・`/nm/*`（描画のページが読む `three`・`@pixiv/three-vrm`・`@pixiv/three-vrm-animation` の node_modules の中だけ）を配る。

## 6. データの置き場と形

作業データの根は `data/`（環境変数 `DATA_DIR` で変えられる。git の外）。JSON は一時ファイルに書いてから名前を変える（書きかけを読まない）。

```
data/
  settings.json
  models/<モデルの id>/   model.vrm・threeview.png・meta.json
  jobs/<依頼の id>/        job.json・source.mp4・bones.glb・motion.vrma・stats.json・bones.mp4・vrm.mp4・compare.mp4・work/（エージェントの作業用）
  compare/                compare-<時刻>-<本数>.mp4（まとめた比較の動画）
```

- モデルの id: `m-<年月日>-<16 進 6 桁>`。依頼の id: `<動きの英字>-<3 桁の連番>`（`wave-001`）。動きの英字はよく使う動きの表（手を振る → `wave`、照れる → `shy`、走る → `run` など）、
  英数字ならそのまま小文字とハイフンに、どちらでもなければ `motion`。id は英数字・`-`・`_` だけ（違えば 400。パスに使うため）

### 6.1 settings.json

```json
{ "comfyuiPath": "", "comfyuiUrl": "http://127.0.0.1:8188", "gemxPath": "" }
```

空のパスは `vendor/ComfyUI`・`vendor/GEM-X` を見る。`~/` はホームに広げる。URL の末尾の `/` は落とす。GEM-X の python は `<GEM-X>/.venv/bin/python`。

### 6.2 meta.json（モデル）

```json
{
  "id": "m-20260101-a1b2c3", "fileName": "character.vrm", "createdAt": "…", "bytes": 0, "heightM": 1.6,
  "threeview": { "state": "done", "width": 3000, "height": 1400, "panelWidth": 1000 },
  "meta": {
    "specVersion": "1.0", "name": "…", "authors": ["…"], "version": "…",
    "avatarPermission": "作者のみ", "commercialUsage": "個人の非営利のみ", "modification": "改変不可", "redistribution": "不許可",
    "violent": "不許可", "sexual": "不許可", "political": "不許可", "antisocial": "不許可", "creditNotation": "表記が要る",
    "licenseUrl": "…", "otherLicenseUrl": "…",
    "warnings": ["このモデルを使ってよいのは「作者のみ」です。…"]
  }
}
```

- `threeview.state`: `pending` → `running` → `done` / `failed`（`error`）
- メタ情報は VRM 1.0（`extensions.VRMC_vrm.meta`）と 0.x（`extensions.VRM.meta`）を同じ形に直す:

| 項目 | 1.0 | 0.x |
|---|---|---|
| 使ってよい人 | `avatarPermission`（onlyAuthor / onlySeparatelyLicensedPerson / everyone） | `allowedUserName`（OnlyAuthor / ExplicitlyLicensedPerson / Everyone） |
| 商用 | `commercialUsage`（personalNonProfit / personalProfit / corporation） | `commercialUssageName`（Allow / Disallow） |
| 改変・再配布 | `modification`・`allowRedistribution` | `licenseName`（`*_ND` は改変不可、Redistribution_Prohibited は再配布不可） |
| 表現 | `allowExcessivelyViolentUsage`・`allowExcessivelySexualUsage`・`allowPoliticalOrReligiousUsage`・`allowAntisocialOrHateUsage` | `violentUssageName`・`sexualUssageName` |

- 注意（`warnings`）を出す条件: 使ってよい人が「誰でも」でない・商用が「法人も可」（0.x は Allow）でない・改変不可・クレジットが要る（1.0）

### 6.3 job.json（依頼）

```json
{
  "id": "wave-001", "slug": "wave", "modelId": "m-…", "motion": "手を振る", "durationSec": 5, "aspect": "9:16", "notes": "…",
  "createdAt": "…", "updatedAt": "…",
  "state": "done", "message": "できた", "log": [{ "at": "…", "state": "waiting", "message": "依頼を作った" }],
  "seed": 1, "retries": 0, "findings": "…",
  "files": { "source.mp4": { "bytes": 0, "at": "…" } },
  "proofs": { "state": "done", "at": "…" },
  "quality": { "footSlideCmPerSec": 0.0, "wristJitter": 0.0, "lowestPointMedianCm": 0.0, "startEndDeg": 0.0, "startEndHipsCm": 0.0,
               "vrmaSec": 5.0, "sourceStartSec": 0, "loop": false, "inPlace": false }
}
```

- `state`（エージェントが書く）: `waiting`（依頼を作った）・`generating`（H3 を焼いている）・`reviewing`（出来を見ている）・`estimating`（GEM-X で推定中）・
  `converting`（.vrma に変換中）・`uploading`（結果を置いている）・`done`（できた）・`failed`（止めた）
- `proofs.state`（サーバが書く）: `none`・`pending`・`running`・`done`・`failed`（`error`）
- `files`: 置かれた結果と、焼いた確認用の動画（名前 → 大きさ・時刻）

### 6.4 stats.json（品質の目安。`tools/gemx2glb.py` が書く）

```json
{
  "frames": 150, "seconds": 5.0, "fps": 30, "facingYawDeg": 0.0, "floorShiftM": [0.0, 0.0],
  "lowestPointCm": { "p5": 0.0, "median": 0.0, "min": 0.0 },
  "footSlide": { "Left": { "contactRatio": 1.0, "medianCmPerSec": 0.0, "p90CmPerSec": 0.0 }, "Right": { "…": "…" } },
  "hipsRangeCm": { "x": 0.0, "y": 0.0, "z": 0.0 },
  "jitterAccMedian": { "Head": 0.0, "LeftHand": 0.0, "RightHand": 0.0, "LeftFoot": 0.0, "RightFoot": 0.0, "LeftHandIndex4": 0.0 },
  "camera": { "R": [[…], […], […]], "c": [x, y, z], "K": [[…], […], […]], "width": 480, "height": 864, "reprojPx": [合わせる前, 後] }
}
```

- `lowestPointCm`: フレームごとの体の表面のいちばん低い所（床を引いた後）。中央値が 0 に近いほどよい（正 = 浮く、負 = 沈む）
- `footSlide`: つま先の付け根が床から 5cm 以内で上下にほとんど動いていないフレーム（接地）の、水平の速さ
- `jitterAccMedian`: 関節の位置の 2 階差分（加速度）の中央値。震えの目安
- `camera`: 元の動画のカメラを、骨の glb の座標で表した物（§10.3）。確認用の骨の動画に使う
- 画面の品質の目安（`job.quality`）は、足の滑り = 左右の `medianCmPerSec` の平均、手首の震え = `LeftHand`・`RightHand` の平均、床 = `lowestPointCm.median`。
  始めと終わりの差は `.vrma` から（骨ごとの最初と最後の回転の角度の最大・腰の位置の差）

### 6.5 motion.vrma の extras

`.vrma` のアニメーションの `extras.h3MotionCreator` に、変換の設定と元の動画との時間の対応を書く（確認画面と確認用の動画が時刻をそろえるのに使う）:

```json
{ "sourceStartSec": 0.0, "sourceEndSec": 5.0, "loop": false, "inPlace": false, "smooth": 0.05, "mirror": false, "lowerBody": "motion" }
```

`sourceStartSec` = `.vrma` の 0 秒が、元の動画（30 コマ/秒にそろえた物）の何秒か。無ければ 0。

### 6.6 置かれた結果の確かめ

| ファイル | 確かめる事 |
|---|---|
| `source.mp4` | 4〜8 バイト目が `ftyp`（mp4） |
| `bones.glb` | glb として読め、アニメーションがある |
| `motion.vrma` | glb として読め、`VRMC_vrm_animation` の拡張とアニメーションがある |
| `stats.json` | JSON として読める（JSON の Content-Type で送られた物は、そのまま整形して書く） |

## 7. 依頼文とセットアップの依頼文

どちらも人がコピーしてエージェントに貼る文。エージェントが自分で API を叩けるよう、サーバの URL・アプリのフォルダの絶対パス・手順書の場所を必ず入れる。

### 7.1 依頼文

```
h3-motion-creator の依頼です（依頼 id: <id>）。
アプリのサーバ: <サーバの URL>（curl で叩ける。認証なし・このマシンの中だけ）
アプリのフォルダ: <アプリのフォルダ>

■ 動き: 「<動き>」 / 尺: <尺> 秒 / 画角: <画角>（<幅>x<高さ>）
■ 注文: <注文>                                  （あるときだけ）
■ キャラクター: <VRM のファイル名>（三面図は依頼の中身にある）
■ 依頼の中身・三面図・設定のパス: curl -s <サーバ>/api/jobs/<id>
■ 手順書: <アプリのフォルダ>/docs/agent-guide.md（最初に全部読む。H3 のプロンプトの決まりは docs/h3-prompt.md）

進め方:
1. GET /api/jobs/<id> で、三面図・ComfyUI の URL・GEM-X のパス・同梱のワークフローと道具の場所を取る。
2. docs/h3-prompt.md の決まりで英文の指示（Ref2VA の 6 節。三面図は <Picture 1>）を書き、tools/h3_r2v.mjs で ComfyUI へ直接投げる。
   コマを見て、崩れていれば seed を変えて焼き直す。
3. GPU のメモリが足りなければ tools/free_vram.sh（任意）。tools/gemx.sh で bones.glb・stats.json を作り、tools/to_vrma/to_vrma.mjs で motion.vrma にする。
   ループ・その場・前の向きは、動きを見て決めてよい。
4. 進み具合は POST …/status、結果は PUT …/files/{source.mp4, bones.glb, motion.vrma, stats.json}。
5. 最後に status を done にして、seed・焼き直しの回数・所見を書く。確認用の動画はアプリが焼く。
```

### 7.2 セットアップの依頼文

環境チェックで「無い」の項目があるときだけ作る。

```
h3-motion-creator のセットアップの依頼です。
アプリのサーバ: <サーバの URL>（GET /api/env で今の結果が取れる）
プロジェクトのフォルダ: <アプリのフォルダ>
手順書: <アプリのフォルダ>/docs/setup.md（最初に読む）

今の設定: ComfyUI のパス（空なら「空 → vendor/ComfyUI」）・URL・GEM-X のパス

足りない物:
- <項目>: <見た物>
  → <直し方>                          （§13 の項目ごとの直し方。パスが空の物は「vendor/ に clone して作る」）

済んでいる物（触らない）: <OK の項目の並び>

決まり:
- 既にある ComfyUI・システムの CUDA とドライバは変えない。新しく入れる物はプロジェクトの vendor/ の中に。
- 動いている ComfyUI を止める・再起動するときは、先に人に確かめる。
- モデルの重みは配布元から取り、それぞれの配布元の決まりに従う。アプリのリポジトリには入れない。
- vendor/ に作ったら PUT /api/settings にそのパスを書く。
- 終わったら GET /api/env がすべて OK になるのを確かめ、入れた物と版を報告する。
```

- ComfyUI のパスが空で `vendor/ComfyUI` も無いのに、設定の URL で ComfyUI が動いているときは、新しく作る前にそのフォルダを人に確かめて設定に書くよう添える

## 8. 三面図の作り方

VRM を登録すると、サーバがヘッドレスのブラウザで `render/threeview.html` を開き、`window.renderThreeView({vrmUrl, panelH, armDown, bg})` を呼ぶ。返った PNG を `threeview.png` に書く。

- 読み込み: three-vrm で読み、`VRMUtils.rotateVRM0`（0.x は 180° 回して +Z を前に）。全部のメッシュの視錐台カリングを切る
- A ポーズ: 正規化した骨（T ポーズが 0）で、上腕を水平から `armDown` = **50°** 下ろす（Z 軸まわり。左腕 −、右腕 +）。前腕を Y 軸まわりに 0.12 rad 回して肘を少し前へ。
  VRM 0.x は正規化した骨のローカルで左右の向きが逆になるので、回りの符号を変える（`meta.metaVersion === '0'`）
- 表情を初期値に戻し、揺れ物を戻してから 1/60 秒で 120 回更新して落ち着かせる
- 範囲: 揺れ物・髪を含む全身の箱（`Box3.setFromObject(…, precise)`）。余白は**身長の 4%**（どの身長でも全身が同じ割合で入る）。
  見る高さ = 身長 + 余白 × 2、見る幅 = max(箱の幅, 箱の奥行き) + 余白 × 2
- カメラ: 正射影。1 面の高さ `panelH` = **1400 px**、幅は見る範囲の縦横比から（2 の倍数。全身の比率でおよそ 1000 px）
- 面: 正面（+Z から）・右側（本人の右 = −X から）・後ろ（−Z から）を、この順に横に並べた 1 枚（幅 = 1 面の幅 × 3）
- 背景 `#f2f2f2`。光は半球光（空 白・地 `#bbbbbb`・強さ 2.0）と、面ごとにカメラの側の少し上から当てる平行光（強さ 1.2）。どの面も同じ明るさにする。影は無し
- 描画は WebGL（SwiftShader で CPU でも描ける）。`meta.json` に大きさと身長（箱の高さ）を書く

## 9. H3 r2v turbo の投げ方

`workflows/minimax_h3_r2v_turbo.json` は ComfyUI の API 形式のグラフ（MiniMax H3 の fl2va の重み ＋ 参照 LoRA ＋ 4step 蒸留 LoRA、SageAttention・Mem Eff Sage Attention・Sol-Attn・SigmaShift・Spectrum の高速化、euler・4 ステップ・1 パス）。
エージェントは `tools/h3_r2v.mjs` か手で、次を差し込んで `POST <ComfyUI>/prompt` に投げる:

| ノード | 入力 | 入れる物 |
|---|---|---|
| `137` LoadImage | `image` | 三面図（`POST /upload/image` で ComfyUI の input に上げた名前。`<Picture 1>` になる） |
| `138` PrimitiveStringMultiline | `value` | 英文の指示（Ref2VA の 6 節。`docs/h3-prompt.md`） |
| `132` PrimitiveFloat | `value` | 尺（秒）。`131` ComfyMathExpression が 24fps の 17k+5 のコマ数に切り上げる（5 秒 = 124 コマ） |
| `136` MiniMaxH3ReferenceToVideo | `width`・`height` | 大きさを数で（`115` ResolutionSelector からのつなぎを置き換える）。9:16 = 480x864、16:9 = 864x480 |
| `129` RandomNoise | `noise_seed` | seed |
| `92` SaveVideo | `filename_prefix` | `h3-motion-creator/<id>-s<seed>` |

- 参照画像 1 枚だけで投げるので、雛形の参照動画・その音声・参照音声のローダー（`140` LoadVideo・`141` GetVideoComponents・`142` LoadAudio）を消し、
  `136` の入力 `ref_videos.ref_video_0`・`ref_video_audios.ref_video_audio_0`・`ref_audios.ref_audio_0` を消す
- ほかの値は変えない。`ref_image_size` は `match`（参照画像を生成の大きさに合わせて縮める）
- 終わりを `GET /history/<prompt_id>` で待ち、`outputs["92"]` の動画を `GET /view` で取る（24 コマ/秒・音声つきの mp4）
- 出来を見て、人が 2 人以上・全身が切れる・カメラが動く・手足の数が違う・体や小物を突き抜ける・依頼と違う動き・始めか終わりが立っていない、なら seed を変えて焼き直す（`docs/agent-guide.md` §5）
- プロンプトの決まり（`docs/h3-prompt.md`）: 英語・6 節・`<Picture 1>` だけ・三面図は見た目の参照で画面には 1 人だけ・カメラ固定・全身・無地のスタジオ・カットなし・始めと終わりはまっすぐ立つ・除外文で終える

## 10. GEM-X の推定と骨の glb

### 10.1 推定（`tools/gemx_infer.py`。`tools/gemx.sh` が呼ぶ）

GEM-X の `scripts/demo/demo_soma.py` の関数を同じ順に呼ぶ（GEM-X のファイルは変えない。GEM-X の根で、その venv の python で動かす）:

1. 動画を **30 コマ/秒**にそろえた写しを出力のフォルダに置く（ffmpeg。GEM-X は 30 コマ/秒として扱う）
2. 前処理（人の検出・追跡・2D の関節・画の特徴）→ GPU のメモリを空ける → 2D の関節を重ねた確かめの動画 → 推定（カメラ固定 `static_cam`）→ `hpe_results.pt`
3. 段ごとに GPU のメモリを空ける。中間ファイルがあればその段は飛ばす。メッシュを重ねた動画は `--render` のときだけ

### 10.2 骨の glb（`tools/gemx2glb.py`）

`hpe_results.pt` の `body_params_global`（`global_orient`・`body_pose` = 76 × 軸と角度・`transl`・`identity_coeffs`・`scale_params`）を、SOMA の 77 関節の骨組み ＋ アニメーション 1 本の glb にする:

- 回転は「T ポーズからの回り」のローカルの回転なので、**T ポーズの関節の位置に回転なしで骨を置いた骨組み**に、そのままローカルの回転として載せる（関節の位置が SOMA と一致する）
- 骨の長さ: その人の体（クリップの平均の `identity_coeffs`・`scale_params`）の T ポーズ。骨組みの腰の高さは、T ポーズで足の裏が y = 0 に来る高さ
- 向き: Y が上。`--facing`（`start` = 始めの 0.5 秒・`mean` = 全体・`ends` = 前後の 0.5 秒）の所の、左右の股関節と肩を結ぶ向きが +X になるよう Y 軸まわりに回す（+Z が前・+X が本人の左）
- 床: フレームごとの体の表面のいちばん低い所の、前後 `--floor_window`（既定 1 秒）の最小値をガウスでならした物を、フレームごとに y = 0 にする（`--floor fixed` なら低いほうから 5% の所を 1 つ）
- 腰の水平の位置: 1 フレーム目を原点に
- 骨の名前は SOMA のまま。30 コマ/秒・入れた動画のコマ数のまま。補間で遠回りしないよう、四元数の符号を前のフレームにそろえる
- 品質の目安とカメラを `stats.json` に書く（§6.4）

### 10.3 元の動画のカメラ（`stats.json` の `camera`）

1. フレームごとに、世界の座標の腰の向きとカメラの座標の腰の向きの差（カメラ → 世界の回転）を出し、glb の向き（Y 軸まわりの回し）を掛けて平均する
2. カメラの位置 = glb の腰 − 回転 × カメラの座標の腰、の平均
3. 元の画（カメラの座標の推定）に骨がいちばん重なるよう、回転と位置を最小二乗（soft L1）で合わせ直す。`reprojPx` に合わせる前と後の画素のずれ
4. `K` は GEM-X のカメラの内部の値。主点が画の真ん中なので、元の画の大きさ = 主点 × 2

## 11. 骨の glb から .vrma への変換

`tools/to_vrma/to_vrma.mjs --glb bones.glb --out motion.vrma [オプション]`（本体は `tools/to_vrma/convert.mjs`。three.js の数の型を使う）。

### 11.1 骨の対応（`tools/to_vrma/soma-bones.mjs`）

| VRM | SOMA |
|---|---|
| hips・spine・chest・upperChest | `Hips`・`Spine1`・`Spine2`・`Chest` |
| neck・head | `Neck1`・`Head`（`Neck2` の回りは頭に入る） |
| {left,right}UpperLeg・LowerLeg・Foot・Toes | `{S}Leg`・`{S}Shin`・`{S}Foot`・`{S}ToeBase` |
| {left,right}Shoulder・UpperArm・LowerArm・Hand | `{S}Shoulder`・`{S}Arm`・`{S}ForeArm`・`{S}Hand` |
| 親指 Metacarpal・Proximal・Distal | `{S}HandThumb1`・`2`・`3` |
| 人差し指・中指・薬指・小指 Proximal・Intermediate・Distal | `{S}Hand{Index,Middle,Ring,Pinky}2`・`3`・`4`（`1` は手のひらの中の骨。その回りは付け根に入る） |

- VRM の骨の親子は VRM 1.0 の humanoid のとおり。素材に無い骨は飛ばし、さらに親につなぐ。必須の骨（hips・spine・head・腕と脚の 6 本ずつ）が無ければ止まる
- 骨ごとのワールドの向きから VRM のローカルの回転を出すので、表に無い間の関節の回りは子の骨に入る。目・あごは扱わない

### 11.2 T ポーズの基準

- glb の基本姿勢（T ポーズ）を基準にする。腕・脚・指はまっすぐの向き（腕 = ±X、脚 = −Y）、親指は手の向きと前の間の 45° にそろえた物を「T ポーズ」とみなす。
  親を直した分を子が受け継いでから、残りの向きのずれだけ回す
- 骨ごとに「T ポーズからの回り」= フレームのワールドの回転 × T ポーズのワールドの回転の逆、を出し、親の回りを除いてローカルの回転にする。四元数の符号は前のフレームにそろえる
- 基本姿勢の左右の股関節を結ぶ向きが +X になるよう Y 軸まわりに回す（glb はそろえてあるので、ふつうは回らない）
- `.vrma` の骨組みは VRM の骨の親子で並べ、T ポーズの位置に**回転なし**で置く（アニメーションの回転がそのまま VRM の正規化した骨の回転になる）。
  腰の高さが、再生するモデルとの大きさの比の基準になる

### 11.3 オプション

| オプション | 働き |
|---|---|
| `--from`・`--to` | 元の動画の秒で切り出す |
| `--smooth <秒>` | 震えをならす（ガウスの幅。既定 0.05。回転は符号をそろえた重み付きの和を正規化、腰は重み付きの平均） |
| `--in-place` | 腰の水平の位置をガウス（0.6 秒）でならした道筋を引いて、進む分を消す（細かい揺れは残る）。端の外は端を中心に点対称に折り返した値で埋める（一定の速さの移動は端まで消える） |
| `--loop [--blend <秒>]` | 切れ目なく繰り返すループ: 始めと終わりの `blend` 秒（既定 0.5）を重ねる。[blend, 終わり − blend) の後に、終わりの blend 秒と始めの blend 秒を smoothstep で混ぜた物をつなぎ、最後に最初のフレームをもう一度置く |
| `--lower-body neutral` | 腰から下（hips・脚・足・つま先）をまっすぐ立った姿勢にし、腰を原点の真上に置く |
| `--mirror` | 左右を入れ替える（x = 0 の面で折り返す。回転 (x, y, z, w) → (x, −y, −z, w)、左右の骨の名前を入れ替える） |

### 11.4 腰の置き場

- 1 回の動き（既定）: 始めと終わりの 0.5 秒（最大 15 フレーム）の両足の真ん中を原点に（待機から入って待機へ抜けるときに足が滑らない）
- ループ: 両足の真ん中の平均を原点にそろえてからつなぎ、腰の水平の位置の平均を原点に

### 11.5 書き出し

glb（glTF 2.0 ＋ `VRMC_vrm_animation` 1.0）。`humanoid.humanBones` に VRM の骨 → ノード。チャンネルは腰の translation と全部の骨の rotation（LINEAR）。
`asset.generator` に道具の名前。著作権の表示は書かない。アニメーションの `extras.h3MotionCreator`（§6.5）。
終わりに、始めと終わりの姿勢の差（骨ごとの角度の最大）・腰の位置の差・1 フレームの回りの最大・T ポーズへの直しの大きさを JSON で出す。

## 12. 確認用の動画の作り方

`source.mp4`・`bones.glb`・`motion.vrma` がそろうと、サーバが 1 本ずつ順に焼く（ファイルが続けて置かれるので、予約から少し待ってから）。3 本とも**元の動画と同じ時間の軸・30 コマ/秒・骨の glb と同じコマ数**。
大きさは元の動画の縦横比のまま、縦長なら高さ 864、横長なら幅 864。

| 動画 | 作り方 |
|---|---|
| `bones.mp4` | `tools/render_bones.py`（GEM-X の venv の python）。骨の glb を FK で関節の位置にし、`stats.json` の `camera` から見た棒人間を描く（カメラが無ければ正面の固定のカメラ）。背景は暗い色、床の目 50cm（1m ごとに濃く）、左 = 青・右 = 赤・真ん中 = 白、腰と腰の跡 = 黄、指は細く。奥の骨から描く。左下に秒 |
| `vrm.mp4` | ヘッドレスのブラウザで `render/vrm-video.html`。モデルの VRM に `motion.vrma` を載せ（視線の回りの proxy を足す）、フレーム i の時刻 = i / 30 − `sourceStartSec`（`.vrma` の外は始め・終わりで止める）。揺れ物は 1/30 秒ずつ進める。カメラは透視（縦の画角 30°）・正面から 15° 本人の左寄り・高さ = 身長 × 0.55・注視点 = 身長 × 0.5・腰の水平の位置を追う・縦に身長 × 1.25、横に身長 × 0.9 が入る距離。身長は骨を一度動かしてから測った全身の箱の高さ。背景 `#e9eaee`、床の目 50cm。JPEG で撮って ffmpeg で mp4 |
| `compare.mp4` | `tools/make_compare.py`。1920x1080・30 コマ/秒。見出しに「動き（id）」と品質の目安の 2 行（足の滑り・手首の震え・床・始めと終わりの差 ／ seed・焼き直し・ループ・その場・尺・画角・状態）。① 元の動画（30 コマ/秒にそろえて）・② `bones.mp4`・③ `vrm.mp4` を同じ大きさの枠で横に並べ、枠の下に名前と説明、右上に時刻。どの依頼の物も同じ大きさ・同じ符号化（H.264・yuv420p・BT.709）にして、ffmpeg の concat（`-c copy`）でつなげるようにする |

まとめた比較の動画（`POST /api/compare`）は、選んだ依頼の `compare.mp4` をそのままつなぐ。

画面の ③ は `vrm.mp4` を使わず、画面の中で three-vrm が同じカメラの決まりで描く（時刻のずれが出ない・つまみで細かく動かせる）。

## 13. 環境チェックの判定

起動したときと、画面の「調べる」で走らせる。見て回る所（事実）を集めてから、項目ごとに **OK・無い** を決める（判定は事実だけから決め、テストでは事実を作って確かめる）。
設定のパスが空なら `vendor/ComfyUI`・`vendor/GEM-X` を見る。全部 OK なら `ready`。

| 項目 | 何で調べる | OK の条件 | 無いときの直し方（セットアップの依頼文に入る） |
|---|---|---|---|
| GPU（CUDA） | `nvidia-smi` | GPU の名前とメモリが取れる | ドライバを入れる（人に確かめる） |
| ffmpeg | PATH | `ffmpeg` と `ffprobe` がある | 入れる（sudo が要るなら人に頼む） |
| ComfyUI の場所 | パス | フォルダと `main.py` がある | 設定のパスなら直すかそこに入れる。空なら `vendor/ComfyUI` に clone して作る（URL で ComfyUI が動いていれば、そのフォルダを人に確かめる） |
| ComfyUI が起動している | URL | `/system_stats` と `/object_info` が取れる | 起動するか URL を直す |
| H3 の本体（fl2va）と LoRA 2 本 | パス（＋ URL） | ワークフローの UNETLoader・LoraLoaderModelOnly が読むファイルが `models/` の下（`diffusion_models`・`unet`・`loras`。3 段まで）にある。ComfyUI のフォルダがあり、`/object_info` の選択肢に名前があれば、別の所に置いた物でもよい | 足りないファイルを `models/<フォルダ>/` に入れる |
| H3 の VAE とテキストエンコーダ | パス（＋ URL） | 同じく VAELoader・CLIPLoader が読むファイル（`vae`・`text_encoders`・`clip`） | 同上 |
| カスタムノード | パス | 本体の `comfy_extras/nodes_minimax_h3.py`・`comfy_extras/nodes_sparse_attention.py`、`custom_nodes/` に `kjnodes`・`spectrum-minimax-h3` を名前に含むフォルダ（大文字小文字は見ない。`.disabled` は除く） | 本体を新しい版に（人に確かめる）。カスタムノードは clone して requirements を ComfyUI の venv に |
| SageAttention | パス | ComfyUI の venv（`venv/` か `.venv/`）の python で `import sageattention` が通る | 合う版を ComfyUI の venv に入れる（再起動は人に確かめる） |
| ComfyUI にノードが登録されている | URL | ワークフローの class_type（外すローダーを除く）が全部 `/object_info` にある | カスタムノードを入れた後に ComfyUI を再起動する |
| GEM-X の場所 | パス | フォルダと `scripts/demo/demo_soma.py` がある | 設定のパスなら直すかそこに入れる。空なら `vendor/GEM-X` に clone して作る |
| GEM-X の venv | パス | `.venv/bin/python` で torch・numpy・scipy・cv2・PIL・hydra・onnxruntime が読め、torch で CUDA が使え、onnxruntime に `CUDAExecutionProvider` がある | uv で venv を作り、GPU に合う CUDA の版の PyTorch・SOMA・onnxruntime-gpu を入れる |
| GEM-X の重み | パス | `inputs/pretrained/gem_soma.ckpt`・`inputs/checkpoints/vitpose/vitpose.pth`・`inputs/checkpoints/sam-3d-body-dinov3/sam3d_body.ckpt`・`inputs/mhr_data/mhr_model.pt`・`inputs/soma_assets/SOMA_neutral.npz`・`inputs/soma_data` | GEM-X の取得の関数で取り、`inputs/soma_assets` のリンクを張る |

- 要るモデルのファイルとノードは、同梱のワークフローから取り出す（ワークフローを差し替えれば、調べる物も変わる）
- 重い調べ（python の import）はサーバを止めないよう別のプロセスで非同期に走らせる。同時に頼まれたら 1 回分を共有する

## 14. ライセンスの方針

- アプリのコードは **Apache-2.0**（`LICENSE`）。同梱のワークフローの JSON・`tools/` の道具も含む。同梱する他者のコードの著作権とライセンスの表記は `THIRD_PARTY_NOTICES.md` にまとめる
- **モデルの重みは同梱しない**。セットアップのときに、使う人の環境へ配布元から取る。使うモデルはそれぞれの配布元の決まりに従い、アプリは重みの条項を説明・表示しない
- **ComfyUI は同梱しない**（GPL-3.0）。HTTP の API で話すだけで、ComfyUI のコードを読み込まない。カスタムノードも同梱しない
- `THIRD_PARTY_NOTICES.md` はリポジトリに入れた物の表記が中心: 写したワークフローの JSON と書き直して入れたコード（MIT）、npm の依存（three.js・three-vrm は MIT。表記を残す）。
  同梱しない物（ComfyUI・カスタムノード・GEM-X とその中のコード）は扱いだけを並べ、モデルの重みは「同梱しない。配布元の決まりに従う」の 1 行にまとめる
- 読み込む VRM は、メタ情報の利用条件を読み込み時に画面に出し、作者のみ・商用の範囲・改変不可・クレジットが要る、には注意を出す。作ってよいかは使う人が確かめる
- 作った動画は使ったモデルの決まりと元の VRM の決まりに、骨と `.vrma` は元の動画の決まりに従う。`.vrma` に著作権の表示は書かない
