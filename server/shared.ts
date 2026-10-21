// 画面とサーバで共有する型（画面からも読むので、Node の物は使わない）

/** 環境チェックの 1 項目の判定 */
export type CheckState = 'ok' | 'missing'

export interface CheckItem {
  id: CheckId
  label: string
  state: CheckState
  /** 何を見たか・見つかった物（画面の 2 行目） */
  detail: string
  /** 足りないときの直し方（セットアップの依頼文に入る） */
  fix?: string
}

export type CheckId =
  | 'ffmpeg'
  | 'comfyui_path'
  | 'comfyui_running'
  | 'h3_models'
  | 'h3_support_models'
  | 'custom_nodes'
  | 'sageattention'
  | 'comfyui_nodes'
  | 'gemx_path'
  | 'gemx_venv'
  | 'gemx_weights'

export interface Settings {
  /** ComfyUI のフォルダ。空なら <アプリ>/vendor/ComfyUI */
  comfyuiPath: string
  /** ComfyUI の URL（既定 http://127.0.0.1:8188） */
  comfyuiUrl: string
  /** GEM-X のフォルダ。空なら <アプリ>/vendor/GEM-X */
  gemxPath: string
  /** ComfyUI を動かす python。空なら ComfyUI のフォルダの中を探す（venv・.venv・python_embeded） */
  comfyuiPython: string
  /** GEM-X の venv の python。空なら GEM-X のフォルダの中を探す（.venv・venv） */
  gemxPython: string
}

/** 実際に見るパス（設定が空のときは vendor/ の物・探して見つかった python） */
export interface ResolvedTools {
  comfyuiPath: string
  comfyuiPathFromSettings: boolean
  gemxPath: string
  gemxPathFromSettings: boolean
  /** 見つからなければ null */
  comfyuiPython: string | null
  comfyuiPythonFromSettings: boolean
  gemxPython: string | null
  gemxPythonFromSettings: boolean
}

export interface EnvReport {
  checkedAt: string
  settings: Settings
  /** 実際に見たパス（空のときは vendor/ の物） */
  resolved: ResolvedTools
  items: CheckItem[]
  /** 全部 OK か */
  ready: boolean
}

/** VRM のメタ情報（利用条件）。0.x と 1.0 を同じ形にそろえた物 */
export interface VrmMeta {
  specVersion: '0.x' | '1.0'
  name: string
  authors: string[]
  version?: string
  /** アバターを使ってよい人 */
  avatarPermission: string
  /** 商用 */
  commercialUsage: string
  /** 改変 */
  modification: string
  /** 再配布 */
  redistribution: string
  /** 暴力・性的・政治や宗教・反社会的な表現（許可 / 不許可 / 不明） */
  violent: string
  sexual: string
  political?: string
  antisocial?: string
  creditNotation?: string
  licenseUrl?: string
  otherLicenseUrl?: string
  /** 画面に出す注意（作者のみ・商用不可・改変不可など） */
  warnings: string[]
}

export interface ModelInfo {
  id: string
  fileName: string
  createdAt: string
  bytes: number
  meta: VrmMeta
  /** 三面図の状態 */
  threeview: { state: 'pending' | 'running' | 'done' | 'failed'; error?: string; width?: number; height?: number; panelWidth?: number }
  /** 三面図を撮ったときの全身の高さ（m。髪・帽子を含む） */
  heightM?: number
}

export type Aspect = '9:16' | '16:9'

/** エージェントが POST /api/jobs/{id}/status で書く進み具合 */
export type JobState = 'waiting' | 'generating' | 'reviewing' | 'estimating' | 'converting' | 'uploading' | 'done' | 'failed'

export const JOB_STATES: JobState[] = ['waiting', 'generating', 'reviewing', 'estimating', 'converting', 'uploading', 'done', 'failed']

export const JOB_STATE_LABEL: Record<JobState, string> = {
  waiting: 'エージェント待ち',
  generating: 'H3 を焼いている',
  reviewing: '出来を見ている',
  estimating: 'GEM-X で推定中',
  converting: '.vrma に変換中',
  uploading: '結果を置いている',
  done: 'できた',
  failed: '失敗',
}

/** エージェントが置く結果のファイル */
export const RESULT_FILES = ['source.mp4', 'bones.glb', 'motion.vrma', 'stats.json'] as const
/** サーバが焼く確認用の動画 */
export const PROOF_FILES = ['bones.mp4', 'vrm.mp4', 'compare.mp4'] as const
export type ResultFile = (typeof RESULT_FILES)[number]
export type ProofFile = (typeof PROOF_FILES)[number]

export interface StatusEntry {
  at: string
  state: JobState
  message?: string
}

export interface Job {
  id: string
  slug: string
  modelId: string
  motion: string
  durationSec: number
  aspect: Aspect
  /** 依頼の画面で足した注文（任意） */
  notes?: string
  createdAt: string
  updatedAt: string
  state: JobState
  /** 最新のひと言（一覧に出る） */
  message?: string
  log: StatusEntry[]
  /** エージェントが書く: 使った seed・焼き直しの回数・所見 */
  seed?: number
  retries?: number
  findings?: string
  /** 置かれた結果のファイル（名前 → 大きさ・時刻） */
  files: Partial<Record<ResultFile | ProofFile, { bytes: number; at: string }>>
  /** 確認用の動画を焼く状態 */
  proofs: { state: 'none' | 'pending' | 'running' | 'done' | 'failed'; error?: string; at?: string }
  /** 品質の目安（stats.json と motion.vrma から、サーバがまとめた物） */
  quality?: Quality
}

export interface Quality {
  /** 足の滑り（つま先が床に着いているフレームの水平の速さの中央値。左右の平均。cm/秒） */
  footSlideCmPerSec?: number
  /** 手首の震え（加速度の中央値。左右の平均。m/s²） */
  wristJitter?: number
  /** 体のいちばん低い所の中央値（cm。0 に近いほどよい。正 = 浮く・負 = 沈む） */
  lowestPointMedianCm?: number
  /** 始めと終わりの姿勢の差（いちばん大きく違う骨の角度。度） */
  startEndDeg?: number
  /** 始めと終わりの腰の位置の差（cm） */
  startEndHipsCm?: number
  /** .vrma の長さ（秒） */
  vrmaSec?: number
  /** .vrma が元の動画のどこから始まるか（秒） */
  sourceStartSec?: number
  loop?: boolean
  inPlace?: boolean
}

/** フォルダの手がかり（ComfyUI らしい: main.py と custom_nodes/ がある・GEM-X らしい: .venv と scripts/demo/ がある） */
export type FolderHint = 'comfyui' | 'gemx'

/** GET /api/fs/dirs の答え（フォルダを選ぶダイアログ） */
export interface DirListing {
  /** 今のフォルダ（絶対パス） */
  path: string
  /** 一つ上（ルートなら null） */
  parent: string | null
  /** パスの区切り（/ か \） */
  sep: string
  home: string
  /** ルート（Windows ならあるドライブ） */
  roots: string[]
  /** パンくず（ルートから今のフォルダまで） */
  crumbs: { name: string; path: string }[]
  /** 今のフォルダの手がかり */
  hints: FolderHint[]
  /** 中のフォルダ（名前順。ファイルは入らない）。link はシンボリックリンク */
  dirs: { name: string; path: string; link?: boolean; hints: FolderHint[] }[]
  /** 隠しフォルダ（. で始まる）の数 */
  hiddenCount: number
  /** 多すぎて途中で切ったか */
  truncated: boolean
}

/** 画面の尺の選択肢（秒） */
export const DURATIONS = [5, 6, 8, 10] as const

/** H3 に渡す大きさ（0.4MP・32 の倍数） */
export function videoSize(aspect: Aspect): { width: number; height: number } {
  return aspect === '9:16' ? { width: 480, height: 864 } : { width: 864, height: 480 }
}
