import { useEffect, useRef, useState } from 'react'
import { DURATIONS, type Aspect, type Job, type ModelInfo } from '../../server/shared'
import { api, copyText } from './api'
import { CopyBox } from './CopyBox'

const SUGGEST = ['手を振る', '照れる', '驚く', '拍手', 'お辞儀', '走る', '歩く', '跳ぶ', 'ダンス', '笑う', '指さす', 'ガッツポーズ']

export function RequestTab({ onGoReview }: { onGoReview: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelId, setModelId] = useState('')
  const [motion, setMotion] = useState('')
  const [duration, setDuration] = useState<number>(5)
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [notes, setNotes] = useState('')
  const [made, setMade] = useState<{ job: Job; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (select?: string) => {
    const ms = await api.models()
    setModels(ms)
    setModelId((cur) => select ?? (cur && ms.some((m) => m.id === cur) ? cur : ms[0]?.id ?? ''))
  }
  useEffect(() => {
    load()
  }, [])

  const model = models.find((m) => m.id === modelId)
  // 三面図ができるまで見に行く
  useEffect(() => {
    if (!model || model.threeview.state === 'done' || model.threeview.state === 'failed') return
    const t = setInterval(() => load(model.id), 2000)
    return () => clearInterval(t)
  }, [model?.id, model?.threeview.state])

  const upload = async (f: File) => {
    setBusy(true)
    setError('')
    try {
      const m = await api.uploadModel(f)
      await load(m.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const make = async () => {
    setBusy(true)
    setError('')
    try {
      setMade(await api.createJob({ modelId, motion, durationSec: duration, aspect, notes }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid2">
      <section className="card">
        <div className="row between">
          <h2>VRM</h2>
          <div className="row">
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="読み込んだ VRM">
              {!models.length && <option value="">（まだ無い）</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fileName}（{m.id}）
                </option>
              ))}
            </select>
            <button onClick={() => fileRef.current?.click()} disabled={busy}>
              VRM を読み込む
            </button>
            <input ref={fileRef} type="file" accept=".vrm" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        </div>
        {model ? (
          <>
            <p className="muted small">
              VRM {model.meta.specVersion} · {model.meta.name || '（名前なし）'}
              {model.meta.authors.length ? ` · 作者 ${model.meta.authors.join('、')}` : ''}
              {model.heightM ? ` · 身長 ${model.heightM.toFixed(2)} m` : ''}
            </p>
            <details className="license" open={model.meta.warnings.length > 0}>
              <summary>利用条件（VRM のメタ情報）{model.meta.warnings.length ? ` · 注意 ${model.meta.warnings.length}` : ''}</summary>
              <dl>
                <dt>使ってよい人</dt>
                <dd>{model.meta.avatarPermission}</dd>
                <dt>商用</dt>
                <dd>{model.meta.commercialUsage}</dd>
                <dt>改変</dt>
                <dd>{model.meta.modification}</dd>
                <dt>再配布</dt>
                <dd>{model.meta.redistribution}</dd>
                <dt>暴力・性的</dt>
                <dd>
                  {model.meta.violent} · {model.meta.sexual}
                </dd>
                {model.meta.creditNotation && (
                  <>
                    <dt>クレジット</dt>
                    <dd>{model.meta.creditNotation}</dd>
                  </>
                )}
                {(model.meta.licenseUrl || model.meta.otherLicenseUrl) && (
                  <>
                    <dt>ライセンス</dt>
                    <dd className="mono small">{[model.meta.licenseUrl, model.meta.otherLicenseUrl].filter(Boolean).join(' · ')}</dd>
                  </>
                )}
              </dl>
              {model.meta.warnings.map((w) => (
                <p key={w} className="warn small">
                  ⚠ {w}
                </p>
              ))}
            </details>
            <figure className="threeview">
              {model.threeview.state === 'done' ? (
                <img src={`/api/models/${model.id}/threeview.png?t=${model.createdAt}`} alt="A ポーズの三面図（正面・右側・後ろ）" />
              ) : model.threeview.state === 'failed' ? (
                <p className="error">三面図を作れませんでした: {model.threeview.error}</p>
              ) : (
                <p className="muted">三面図を作っています…</p>
              )}
              <figcaption className="muted small">三面図（A ポーズ・正射影・正面／右側／後ろ）· サーバが自動で作成</figcaption>
            </figure>
          </>
        ) : (
          <p className="muted">VRM（0.x / 1.0）を読み込むと、サーバが A ポーズの三面図を作ります。</p>
        )}
      </section>
      <section className="card">
        <h2>依頼</h2>
        <label className="field">
          <span>作りたい動き</span>
          <input value={motion} list="motions" placeholder="例: 手を振る" onChange={(e) => setMotion(e.target.value)} />
          <datalist id="motions">
            {SUGGEST.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <div className="row wrap">
          <fieldset className="seg">
            <legend>尺</legend>
            {DURATIONS.map((d) => (
              <label key={d} className={duration === d ? 'on' : ''}>
                <input type="radio" name="dur" checked={duration === d} onChange={() => setDuration(d)} />
                {d} 秒
              </label>
            ))}
          </fieldset>
          <fieldset className="seg">
            <legend>画角</legend>
            {(['9:16', '16:9'] as Aspect[]).map((a) => (
              <label key={a} className={aspect === a ? 'on' : ''}>
                <input type="radio" name="aspect" checked={aspect === a} onChange={() => setAspect(a)} />
                {a}
              </label>
            ))}
          </fieldset>
        </div>
        <label className="field">
          <span>注文（任意）</span>
          <textarea rows={2} value={notes} placeholder="例: 右手で 3 回振る。最後は正面を向いて止まる" onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="row">
          <button className="primary" disabled={busy || !modelId || !motion.trim() || model?.threeview.state !== 'done'} onClick={make}>
            依頼文を作る
          </button>
          {model && model.threeview.state !== 'done' && <span className="muted small">三面図ができると押せます</span>}
        </div>
        {error && <p className="error">{error}</p>}
        {made && (
          <>
            <h3>
              依頼文 <span className="mono">{made.job.id}</span>
            </h3>
            <p className="muted small">コピーして、自分のコーディングエージェントに貼って実行してください。進み具合と結果は「確認」のタブに出ます。</p>
            <CopyBox text={made.text} copy={copyText} />
            <button className="link" onClick={onGoReview}>
              確認のタブへ →
            </button>
          </>
        )}
      </section>
    </div>
  )
}
