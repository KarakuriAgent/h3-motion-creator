import { useEffect, useState } from 'react'
import type { EnvReport, Settings } from '../../server/shared'
import { api, copyText, type SettingsView } from './api'
import { CopyBox } from './CopyBox'

const MARK = { ok: '✓', missing: '✕' } as const
const WORD = { ok: 'OK', missing: '無い' } as const

export function EnvTab() {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [form, setForm] = useState<Settings>({ comfyuiPath: '', comfyuiUrl: '', gemxPath: '' })
  const [env, setEnv] = useState<EnvReport | null>(null)
  const [setup, setSetup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const check = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.env()
      setEnv(r)
      setSetup((await api.setupRequest()).text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s)
      setForm({ comfyuiPath: s.comfyuiPath, comfyuiUrl: s.comfyuiUrl, gemxPath: s.gemxPath })
    })
    api
      .env(true)
      .then((r) => {
        setEnv(r)
        return api.setupRequest().then((s) => setSetup(s.text))
      })
      .catch(() => check())
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      const s = await api.saveSettings(form)
      setSettings(s)
      setForm({ comfyuiPath: s.comfyuiPath, comfyuiUrl: s.comfyuiUrl, gemxPath: s.gemxPath })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await check()
  }

  return (
    <div className="grid2">
      <section className="card">
        <h2>最初の設定</h2>
        <p className="muted small">パスを空にすると、プロジェクトの vendor/ の下（vendor/ComfyUI・vendor/GEM-X）を見ます。無ければセットアップの依頼文に「vendor/ に clone して作る」と書きます。</p>
        <label className="field">
          <span>ComfyUI のパス</span>
          <input value={form.comfyuiPath} placeholder="空 → vendor/ComfyUI" onChange={(e) => setForm({ ...form, comfyuiPath: e.target.value })} />
          {settings && <small className="muted">見る所: {settings.resolved.comfyuiPath}</small>}
        </label>
        <label className="field">
          <span>ComfyUI の URL</span>
          <input value={form.comfyuiUrl} placeholder="http://127.0.0.1:8188" onChange={(e) => setForm({ ...form, comfyuiUrl: e.target.value })} />
        </label>
        <label className="field">
          <span>GEM-X のパス</span>
          <input value={form.gemxPath} placeholder="空 → vendor/GEM-X" onChange={(e) => setForm({ ...form, gemxPath: e.target.value })} />
          {settings && <small className="muted">見る所: {settings.resolved.gemxPath}</small>}
        </label>
        <div className="row">
          <button className="primary" disabled={busy} onClick={save}>
            保存して調べる
          </button>
          <button disabled={busy} onClick={check}>
            もう一度調べる
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
      <section className="card">
        <div className="row between">
          <h2>環境チェック</h2>
          <span className={env?.ready ? 'badge ok' : 'badge bad'}>{busy ? '調べています…' : env ? (env.ready ? 'すべて OK' : '足りない物があります') : '…'}</span>
        </div>
        {env && (
          <ul className="checks">
            {env.items.map((i) => (
              <li key={i.id} className={`check ${i.state}`}>
                <span className="mark" aria-hidden>
                  {MARK[i.state]}
                </span>
                <div className="body">
                  <div className="label">{i.label}</div>
                  <div className="detail muted">{i.detail}</div>
                </div>
                <span className="state">{WORD[i.state]}</span>
              </li>
            ))}
          </ul>
        )}
        {env && <p className="muted small">調べた時刻: {new Date(env.checkedAt).toLocaleString()}</p>}
        {setup ? (
          <>
            <h3>セットアップの依頼文</h3>
            <p className="muted small">コピーして、自分のコーディングエージェントに貼ってください。足りない物だけを入れるように書いてあります。</p>
            <CopyBox text={setup} copy={copyText} />
          </>
        ) : (
          env?.ready && <p className="muted small">セットアップの依頼文は要りません。「依頼」のタブへ進めます。</p>
        )}
      </section>
    </div>
  )
}
