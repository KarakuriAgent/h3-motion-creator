// 人がコピーしてエージェントに貼る文: 依頼文とセットアップの依頼文
import type { EnvReport, Job, ModelInfo } from './shared.js'
import { videoSize } from './shared.js'

export interface TextContext {
  /** アプリのサーバの URL（http://127.0.0.1:4170） */
  serverUrl: string
  /** アプリのフォルダ（絶対パス） */
  appRoot: string
}

/** 動きの言葉から依頼の id の頭を作る（よく使う言葉は英語に。英数字ならそのまま。ほかは motion） */
const SLUGS: Record<string, string> = {
  走る: 'run',
  歩く: 'walk',
  跳ぶ: 'jump',
  ジャンプ: 'jump',
  手を振る: 'wave',
  照れる: 'shy',
  驚く: 'surprised',
  拍手: 'clap',
  お辞儀: 'bow',
  ダンス: 'dance',
  踊る: 'dance',
  座る: 'sit',
  笑う: 'laugh',
  怒る: 'angry',
  悲しむ: 'sad',
  考える: 'think',
  指さす: 'point',
  うなずく: 'nod',
  首をかしげる: 'head-tilt',
  ガッツポーズ: 'fist-pump',
  ピース: 'peace',
  伸び: 'stretch',
  キック: 'kick',
  パンチ: 'punch',
}

export function motionSlug(motion: string): string {
  const m = motion.trim()
  if (SLUGS[m]) return SLUGS[m]
  for (const [k, v] of Object.entries(SLUGS)) if (m.startsWith(k)) return v
  const ascii = m
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return /^[a-z]/.test(ascii) ? ascii : 'motion'
}

/** 依頼文（依頼の画面の「依頼文を作る」） */
export function requestText(job: Job, model: ModelInfo | undefined, c: TextContext): string {
  const id = job.id
  const api = `${c.serverUrl}/api/jobs/${id}`
  const { width, height } = videoSize(job.aspect)
  return [
    `h3-motion-creator の依頼です（依頼 id: ${id}）。`,
    `アプリのサーバ: ${c.serverUrl}（curl で叩ける。認証なし・このマシンの中だけ）`,
    `アプリのフォルダ: ${c.appRoot}`,
    '',
    `■ 動き: 「${job.motion}」 / 尺: ${job.durationSec} 秒 / 画角: ${job.aspect}（${width}x${height}）`,
    ...(job.notes ? [`■ 注文: ${job.notes}`] : []),
    `■ キャラクター: ${model ? `${model.fileName}（三面図は依頼の中身にある）` : job.modelId}`,
    `■ 依頼の中身・三面図・設定のパス: curl -s ${api}`,
    `■ 手順書: ${c.appRoot}/docs/agent-guide.md（最初に全部読む。H3 のプロンプトの決まりは docs/h3-prompt.md）`,
    '',
    '進め方:',
    `1. curl -s ${api} で、三面図（threeview.path）・ComfyUI の URL・GEM-X のパス・同梱のワークフローと道具の場所を取る。`,
    `2. docs/h3-prompt.md の決まりで英文の指示（Ref2VA の 6 節。三面図は <Picture 1>）を書き、tools/h3_r2v.mjs で workflows/minimax_h3_r2v_turbo.json に三面図・指示・尺・大きさ・seed を入れて ComfyUI へ直接投げる。`,
    '   できた動画のコマを見て、崩れていれば（手足の数・体のすり抜け・全身が切れる・人が増える・カメラが動く）seed を変えて焼き直す。',
    '3. GPU のメモリが足りなければ tools/free_vram.sh（任意。ComfyUI は止めない）。tools/gemx.sh で GEM-X の推定と bones.glb・stats.json を作り、tools/to_vrma/to_vrma.mjs で motion.vrma にする。',
    '   ループにするか・その場にするか・前の向きをどこで測るかは、動きを見て決めてよい。',
    `4. 進み具合は POST ${api}/status、結果は PUT ${api}/files/{source.mp4, bones.glb, motion.vrma, stats.json}（--data-binary @ファイル）。`,
    '5. 最後に status を done にして、使った seed・焼き直しの回数・所見（足の滑り・震え・手の位置・ループやその場にしたか）を書く。確認用の動画はアプリが焼く。',
  ].join('\n')
}

/** セットアップの依頼文（足りない物だけを入れる）。全部 OK なら null */
export function setupRequestText(env: EnvReport, c: TextContext): string | null {
  const missing = env.items.filter((i) => i.state === 'missing')
  if (!missing.length) return null
  const done = env.items.filter((i) => i.state === 'ok').map((i) => i.label)
  const lines = [
    'h3-motion-creator のセットアップの依頼です。',
    `アプリのサーバ: ${c.serverUrl}（GET ${c.serverUrl}/api/env で今の結果が取れる）`,
    `プロジェクトのフォルダ: ${c.appRoot}`,
    `手順書: ${c.appRoot}/docs/setup.md（最初に読む）`,
    '',
    '今の設定:',
    `- ComfyUI のパス: ${env.settings.comfyuiPath || '（空 → vendor/ComfyUI）'} / URL: ${env.settings.comfyuiUrl}`,
    `- GEM-X のパス: ${env.settings.gemxPath || '（空 → vendor/GEM-X）'}`,
    '',
    '足りない物:',
    ...missing.flatMap((i) => [`- ${i.label}: ${i.detail}`, ...(i.fix ? [`  → ${i.fix}`] : [])]),
    '',
    `済んでいる物（触らない）: ${done.length ? done.join('・') : 'なし'}`,
    '',
    '決まり:',
    '- 既にある ComfyUI・システムの CUDA とドライバは変えない（ComfyUI の venv に足すのは、足りない物だけ）。新しく入れる物はプロジェクトの vendor/ の中に。',
    '- 動いている ComfyUI を止める・再起動するときは、先に人に確かめる。',
    '- モデルの重みは配布元から取り、それぞれの配布元の決まりに従う。アプリのリポジトリには入れない。',
    `- vendor/ に作ったら PUT ${c.serverUrl}/api/settings にそのパスを書く（例: {"gemxPath": "${c.appRoot}/vendor/GEM-X"}）。`,
    `- 終わったら GET ${c.serverUrl}/api/env がすべて OK になるのを確かめ、入れた物と版を報告する。`,
  ]
  return lines.join('\n')
}
