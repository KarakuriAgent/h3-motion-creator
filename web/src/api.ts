// サーバの API を呼ぶ小さな包み
import type { EnvReport, Job, ModelInfo, Settings } from '../../server/shared'

async function call<T>(method: string, url: string, body?: unknown, raw?: Blob): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`)
  return j as T
}

export type SettingsView = Settings & { resolved: { comfyuiPath: string; gemxPath: string; comfyuiPathFromSettings: boolean; gemxPathFromSettings: boolean } }

export const api = {
  env: (cached = false) => call<EnvReport>('GET', `/api/env${cached ? '?cached=1' : ''}`),
  setupRequest: () => call<{ text: string | null; env: EnvReport }>('GET', '/api/setup-request'),
  settings: () => call<SettingsView>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => call<SettingsView>('PUT', '/api/settings', s),
  models: () => call<ModelInfo[]>('GET', '/api/models'),
  model: (id: string) => call<ModelInfo>('GET', `/api/models/${id}`),
  uploadModel: (file: File) => call<ModelInfo>('POST', `/api/models?name=${encodeURIComponent(file.name)}`, undefined, file),
  jobs: () => call<Job[]>('GET', '/api/jobs'),
  createJob: (b: { modelId: string; motion: string; durationSec: number; aspect: string; notes?: string }) => call<{ job: Job; text: string }>('POST', '/api/jobs', b),
  requestText: (id: string) => call<{ text: string }>('GET', `/api/jobs/${id}/request-text`),
  rebake: (id: string) => call<Job>('POST', `/api/jobs/${id}/proofs`),
  compare: (ids: string[]) => call<{ name: string; url: string }>('POST', '/api/compare', { ids }),
}

export const fileUrl = (id: string, name: string, download = false) => `/api/jobs/${id}/files/${name}${download ? '?download=1' : ''}`

/** クリップボードにコピー（使えなければ選択して返す） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
