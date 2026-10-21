# H3 のプロンプトの決まり（モーションづくり用）

MiniMax H3 の参照モード（Ref2VA。`workflows/minimax_h3_r2v_turbo.json`）に、キャラクターの三面図を参照画像として 1 枚渡し、
**動きを取り出すための動画**を作るときの書き方。ここに無い決まり（台詞・音・複数カット・音楽など）は、モーションづくりでは使わない。

## 1. この用途の決まり（いちばん大事）

GEM-X は 1 本のカメラの映像から 1 人の体の動きを推定する。推定がうまくいく画にする:

- **カメラは固定**（三脚に固定・パン・ズーム・揺れなし）。カメラが動くと、人が動いたことになる
- **全身がいつも画の中**（頭の上から足の先まで。頭の上と足の下に余白）。足が切れると床と足の滑りが崩れる
- **1 人だけ**。三面図は見た目の参照で、**画面に出るのはその人物 1 人だけ**と必ず書く（書かないと 3 人並んだり、三面図をそのまま映したりする）
- **無地の背景**・はっきりした床（明るい白いスタジオ・明るいグレーの床・柔らかく均一な光・足元に薄い影）
- **カットなし**（`[Shot 1]` だけ。1 つの連続した画）
- 体の正面か斜め前から（真横・真後ろは左右を取り違えやすい）。胸の高さ・正面から少し斜め（3/4 正面）の全身（full shot）が基本
- **動きの前後に、まっすぐ立っている所を入れる**（「まっすぐ立った姿勢から〜して、まっすぐ立った姿勢に戻る」）。身ぶりは待機から入って待機へ抜けるので、始めと終わりの姿勢をそろえる
- 動きは速すぎない（ぶれると関節がずれる）。「くっきりとピントが合い、動きの中でもブレは無い」と書く
- ループさせたい動き（走る・歩く・踊るなど）は「その場で」と書くと腰が流れない。進む動きは画の外に出ないよう、斜め手前へ数歩までにする
- 手を顔・体に当てる動きは、当てる所を具体的に書く（「指は眼鏡に触れないよう、その下の頬に添える」など）。手が小物を突き抜ける崩れが減る

## 2. 6 節の形（Ref2VA）

英語で、次の 6 節をこの順に書く:

```
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

- `subject_definitions`: 追う物を 1 行ずつ。`<Subject N>` = 使い回す見た目の物（人物）。参照画像が人物を決めるだけなら、
  **独立した `<Picture N>` の行は作らず**、Subject の行の中で `<Picture 1>` を引く。三面図であること・見た目だけを決めることもここに書く
- `summary`: `[reference generation]` で始める短い 1 段落（参照画像を見た目に使うだけなので、ほかの種類は付けない）
- `retention_analysis`: ラベルごとに 1 行。印は `fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`。
  Subject の括弧は出る所: `<Subject 1> (appears in [Shot 1]): fully_preserved - …`。
  **三面図の並び（同じ人物が 3 人並ぶ形）は写さず、画面には 1 人だけ 1 回出る**ことをここにも書く
- `detailed_description`: `[Shot 1]` の**前に**画風を 1〜2 文（例: `The target video is 3D CG in a cel-shaded anime style, matching the look of the 3D character model in <Picture 1>`）。
  次に `[Shot 1]`（時刻は付けない）で、構図・人物・場所・光・カメラ・動きの段取りを書く。参照を写し直すように描かず、**どの参照がどこを決めるか**を言う。
  生成は 350〜500 語くらいが目安（事実が足りなければ水増ししない。1 ショットでも短くしない）
- `overall_soundscape`: 1〜4 文。静かなスタジオの室内音と、動きの物音（衣擦れ・足音）くらい。**声・台詞は無い**と書く
- `non_diegetic_music`: `N/A`

## 3. 参照画像の書き方

- 渡した順に `<Picture 1>`（三面図 1 枚だけなので、いつも `<Picture 1>`）。**渡していない番号のタグは書かない**（`<Picture 2>` などは静かに無視されるか崩れる）
- 三面図は「1 人の人物を正面・右側・後ろから見た character turnaround sheet で、**見た目だけを決める**」と書く
- 見た目（体形・髪・服・小物・画風）を言葉でも書き、`fully_preserved` で保つ物として並べる。三面図に無い物（小物・持ち物）を足さない

## 4. 英文の決まり

- 投入するのは英語だけ（日本語のまま投げない。`tools/h3_r2v.mjs` は日本語が入っていると止まる）。直訳ではなく、上の形の英文として書き直す
- 事実を足さない・減らさない。依頼に無い人物・小物・台詞・筋を作らない。書かれた動作の段取り（体・接触・視線・終わりの状態）は膨らませてよい
- カメラの動きは文の中の自然な英語で（`The camera remains locked off on a tripod at chest height as a static shot, with no movement and no zoom`）。
  `Camera:` や `Audio:` の行を付けない。`[0s-1.5s]` のような時刻の書き方もしない
- 尺・大きさ・コマ数・fps は本文に書かない（ワークフローに入れる）
- 画面の中の文字は無い前提。最後に除外文を 1 行置く（ネガティブプロンプトは無いので、これが字幕・ロゴの焼き込みの安全網）:

```
No text, subtitles, logos or watermarks.
```

## 5. 実例（三面図を参照にした「照れる」・5 秒・9:16）

`{…}` は三面図に写っているキャラクターの見た目に置き換える（髪・服・小物・画風）。三面図に無い物は書かない。

```
subject_definitions:
<Subject 1> is the {young woman} shown in <Picture 1>. <Picture 1> is a character turnaround sheet of this one {woman} seen from the front, from {her} right side and from behind; it defines {her} appearance only. {She} has {a slim build, long blonde hair woven into two braids that hang forward over her shoulders, a baseball cap, over-ear headphones, small round sunglasses, a loose short-sleeved T-shirt, wide trousers and sneakers}, rendered as a {3D anime-style (cel-shaded)} character model.

summary:
[reference generation] The target video shows <Subject 1> alone, standing in an empty white studio, pressing {her} palms to {her} cheeks, bashfully twisting {her} upper body from side to side, and lowering {her} hands back to a standing pose.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - face, body proportions, {hair, cap, headphones, sunglasses, T-shirt, trousers, sneakers} and the {3D anime-style cel-shaded} rendering from <Picture 1> are retained. The turnaround layout of <Picture 1> is not reproduced: only one {woman} appears, once, in the frame.

detailed_description:
The target video is {3D CG in a cel-shaded anime style}, matching the look of the 3D character model in <Picture 1>, crisply focused and free of motion blur even while {she} moves.
[Shot 1] A full shot from chest height at a slight three-quarter front angle frames <Subject 1>, the only person in the frame, from the top of {her head} to the tips of {her shoes}, leaving clear space above {her} head and below {her} feet. {She} stands in an empty, bright white studio on a light grey floor; soft, even light falls from all sides and leaves only a faint shadow under {her} feet. The camera remains locked off on a tripod at chest height as a static shot, with no movement and no zoom, as one continuous take without cuts. From an upright standing pose, {she} gently brings both palms up to {her} cheeks, fingers resting on {her} cheeks {below the sunglasses and clear of the cap, never touching or pressing into the lenses or the brim}. Bashfully, {she} twists {her} upper body gently to the left and right two or three times while {her} hands stay on {her} cheeks. Then {she} lowers {her} hands to {her} sides and returns to an upright standing pose.

overall_soundscape:
Quiet room tone of an empty studio and the soft rustle of {her} clothes as {she} twists. No one speaks.

non_diegetic_music:
N/A

No text, subtitles, logos or watermarks.
```

## 6. 書いた後に見る所

- `<Picture 1>` 以外のタグが無いか・6 節がそろっているか・`[Shot 1]` が 1 つだけか
- 「1 人だけ」「全身」「カメラ固定」「無地のスタジオ」「始めと終わりはまっすぐ立つ」が入っているか
- 日本語が残っていないか・最後に除外文があるか
