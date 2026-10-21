# THIRD_PARTY_NOTICES

h3-motion-creator のコードは Apache License 2.0（`LICENSE`）。このファイルは、アプリが使う・読む・書き直して入れた他の物の決まりを並べる。
**モデルの重みはアプリに入れていない**（セットアップのときに、使う人の環境へ配布元から取る）。重みを使う人は、それぞれの決まりに従う。

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
| GEM-X の重み（`nvidia/GEM-X`: `gem_soma.ckpt`・`vitpose.pth`） | NVIDIA Open Model License | 同梱しない。商用で使える。**出力（動き）は NVIDIA が持ち主と主張しない**（"NVIDIA claims no ownership rights in outputs"）。重みを配るときは「Licensed by NVIDIA Corporation under the NVIDIA Open Model License」の Notice が要る |
| SAM 3D Body の重み（`sam3d_body.ckpt`。GEM-X が必ず読む） | SAM License | 同梱しない。商用で使える。配るときはライセンスの写しを付ける・研究の発表では使ったと書く・輸出の規制と軍事などの用途の禁止・リバースエンジニアリングの禁止 |
| SOMA（体のモデル）・MHR（体の形） | Apache-2.0 | GEM-X と一緒に入る。同梱しない |
| YOLOX・ByteTrack（人の検出と追跡のコード） | Apache-2.0・MIT | GEM-X の中に入っている。同梱しない |
| YOLOX の重み（OpenMMLab `yolox_x_8xb8-300e_humanart`。初めて推定したときに取ってくる） | **要確認** | COCO と Human-Art で学習した物。Human-Art のデータセットの決まりを確かめる。気になるなら COCO だけで学習した重みに替える |
| MiniMax H3 の重み・LoRA・VAE（`minimax_h3_fl2va_pruned_w4a8_mixed`・参照 LoRA・4step 蒸留 LoRA・映像と音声の VAE） | **MiniMax H3 Community License Agreement**（要確認: 量子化・LoRA は第三者の配布物。それぞれの配布元の決まりも読む） | 同梱しない。下の §4 |
| Qwen3-VL-32B のテキストエンコーダ（`qwen3vl_32b_heretic_minimax_h3_nvfp4`） | Apache-2.0（元の Qwen3-VL。量子化した配布物の決まりも読む） | 同梱しない |

## 4. MiniMax H3 Community License の要点（使う人へ）

全文: `https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE`。アプリは重みを配らないが、アプリで動画を作る人は次に従う（要約。正しくは全文）:

- 使ってよい地域（Applicable Territory）は世界から**EU・英国・韓国・米国を除いた所**。それ以外での利用・出力の利用は許されていない
- 受容可能な利用方針（Acceptable Use Policy）に従う。出力やその結果を、MiniMax H3 とその派生以外の AI モデルの改善に使わない
- MiniMax は出力の権利を主張しない（出力とその使い方の責任は使う人）
- 年の売上が 2,000 万米ドルを超える商用の製品・サービスは、事前に MiniMax の書面の許可が要る。商用の製品・サービスの画面には「MiniMax H3」をはっきり出す
  （アプリの画面の下に出している）
- 重み・派生物を第三者に配るときは、契約の写しと NOTICE（"MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved."）を付ける

## 5. 読み込む VRM

VRM ごとに決まりが違う。アプリは読み込んだときに VRM のメタ情報（使ってよい人・商用・改変・再配布・暴力や性的な表現・クレジット）を画面に出し、
「作者のみ」「商用不可」「改変不可」などは注意を出す。三面図・動画・.vrma を作ってよいかは、使う人がモデルの決まりで確かめる。

## 6. 作った物（動画・.vrma）

- H3 の動画: MiniMax H3 Community License（§4）と、元の VRM の決まりに従う
- 骨・.vrma: GEM-X の出力（NVIDIA は持ち主と主張しない）。元の動画の決まりに従う。.vrma に著作権の表示は書かない
