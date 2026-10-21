# THIRD_PARTY_NOTICES

h3-motion-creator のコードは Apache License 2.0（`LICENSE`）。このファイルは、リポジトリに入れた他者の物（写したワークフロー・書き直して入れたコード・依存のライブラリ）の表記を並べる。

## 1. アプリに入れた物（写し・書き直し）

| 物 | 入れた所 | ライセンス | 表記 |
|---|---|---|---|
| H3 r2v turbo のワークフロー（ComfyUI の API 形式のグラフ） | `workflows/minimax_h3_r2v_turbo.json`（そのままの写し） | MIT License, Copyright (c) 2026 0235 Inc.（株式会社0235） | 下の §1.1 |
| 人型のアニメーションの変換（T ポーズ基準・骨の対応・VRMC_vrm_animation の書き出し・ならし・その場・ループ） | `tools/to_vrma/convert.mjs`（一部を書き直して入れた） | MIT License, Copyright (c) 2026 株式会社0235 | 下の §1.1 |

### 1.1 MIT License（上の 2 つ）

```
MIT License

Copyright (c) 2026 0235 Inc. (株式会社0235)      [workflows/minimax_h3_r2v_turbo.json]
Copyright (c) 2026 株式会社0235                   [tools/to_vrma/convert.mjs]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. npm の依存（node_modules。配るときは各パッケージの LICENSE を残す）

| 物 | ライセンス | 表記 |
|---|---|---|
| three.js | MIT | Copyright © 2010-2026 three.js authors |
| @pixiv/three-vrm・@pixiv/three-vrm-animation | MIT | Copyright (c) 2019-2026 pixiv Inc. |
| React・React DOM | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| Fastify・@fastify/static | MIT | Copyright (c) 2016-present The Fastify Team |
| playwright-core | Apache-2.0 | Copyright (c) Microsoft Corporation |

ビルドした画面（`dist/web`）には three.js・three-vrm・React が入る。表記はそれぞれの LICENSE のとおり残す。

## 3. 同梱しない物（HTTP で話す・別の venv で動かす）

| 物 | 決まり | アプリでの扱い |
|---|---|---|
| ComfyUI | GPL-3.0 | **同梱しない**。アプリは ComfyUI の HTTP の API（`/prompt`・`/history`・`/view`・`/upload/image`・`/free`・`/system_stats`・`/object_info`）で話すだけで、ComfyUI のコードを読み込まない。アプリのライセンスには及ばない |
| ComfyUI-KJNodes・ComfyUI-Spectrum-MiniMax-H3（カスタムノード） | GPL-3.0 | 同梱しない。使う人の ComfyUI に入れる |
| SageAttention | Apache-2.0 | 同梱しない。使う人の ComfyUI の venv に入れる |
| GEM-X のコード（NVlabs/GEM-X） | Apache-2.0 | 同梱しない。アプリの Python の道具（`tools/gemx_infer.py` など）が GEM-X の venv で GEM-X の関数を呼ぶ（GEM-X のファイルは変えない） |
| SOMA（体のモデル）・MHR（体の形） | Apache-2.0 | GEM-X と一緒に入る。同梱しない |
| YOLOX・ByteTrack（人の検出と追跡のコード） | Apache-2.0・MIT | GEM-X の中に入っている。同梱しない |

**モデルの重み**（MiniMax H3 の重み・LoRA・VAE、テキストエンコーダ、GEM-X・SAM 3D Body・YOLOX の重みなど）は同梱しない。使うモデルはそれぞれの配布元の決まりに従う。

## 4. 読み込む VRM

VRM ごとに決まりが違う。アプリは読み込んだときに VRM のメタ情報（使ってよい人・商用・改変・再配布・暴力や性的な表現・クレジット）を画面に出し、
「作者のみ」「商用不可」「改変不可」などは注意を出す。三面図・動画・.vrma を作ってよいかは、使う人がモデルの決まりで確かめる。

## 5. 作った物（動画・.vrma）

- 動画・骨・.vrma: 使ったモデルの配布元の決まりと、元の VRM の決まりに従う。.vrma に著作権の表示は書かない
