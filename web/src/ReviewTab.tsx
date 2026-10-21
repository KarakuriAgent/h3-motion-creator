import { useEffect, useMemo, useRef, useState } from 'react'
import { JOB_STATE_LABEL, type Job } from '../../server/shared'
import { api, copyText, fileUrl } from './api'
import { CopyBox } from './CopyBox'
import { VrmPane } from './VrmPane'

const PROOF_LABEL = { none: '結果待ち', pending: '確認用の動画を待っている', running: '確認用の動画を焼いている', done: '確認用の動画あり', failed: '確認用の動画の失敗' } as const

export function ReviewTab() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [sel, setSel] = useState<string>(() => location.hash.split('/')[1] ?? '')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [merged, setMerged] = useState<{ url: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = () => api.jobs().then(setJobs).catch(() => {})
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const job = jobs.find((j) => j.id === sel) ?? null
  const choose = (id: string) => {
    setSel(id)
    history.replaceState(null, '', `#review/${id}`)
  }

  const merge = async () => {
    setBusy(true)
    setError('')
    try {
      setMerged(await api.compare(jobs.filter((j) => checked.has(j.id)).map((j) => j.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const canMerge = [...checked].filter((id) => jobs.find((j) => j.id === id)?.files['compare.mp4']).length

  return (
    <div className="review">
      <section className="card list">
        <div className="row between">
          <h2>依頼</h2>
          <span className="muted small">
            {jobs.length} 本 · できた {jobs.filter((j) => j.state === 'done').length}
          </span>
        </div>
        <table className="jobs">
          <thead>
            <tr>
              <th aria-label="まとめる" />
              <th>動き</th>
              <th>尺</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className={j.id === sel ? 'on' : ''} onClick={() => choose(j.id)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`${j.id} を比較の動画にまとめる`}
                    disabled={!j.files['compare.mp4']}
                    checked={checked.has(j.id)}
                    onChange={(e) => {
                      const s = new Set(checked)
                      if (e.target.checked) s.add(j.id)
                      else s.delete(j.id)
                      setChecked(s)
                    }}
                  />
                </td>
                <td>
                  <div>{j.motion}</div>
                  <div className="mono small muted">{j.id}</div>
                </td>
                <td className="small">{j.quality?.vrmaSec ? `${j.quality.vrmaSec} 秒` : `${j.durationSec} 秒`}</td>
                <td>
                  <span className={`badge ${j.state === 'done' ? 'ok' : j.state === 'failed' ? 'bad' : 'run'}`}>{JOB_STATE_LABEL[j.state]}</span>
                  {j.message && <div className="small muted clip">{j.message}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row wrap">
          <button disabled={busy || canMerge < 1} onClick={merge}>
            選んだ物の比較動画をまとめて 1 本に（{canMerge}）
          </button>
          {merged && (
            <a href={merged.url} download>
              {merged.name} をダウンロード
            </a>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </section>
      <section className="card detail">{job ? <JobDetail job={job} /> : <p className="muted">左の一覧から依頼を選んでください。</p>}</section>
    </div>
  )
}

function JobDetail({ job }: { job: Job }) {
  const [text, setText] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const v1 = useRef<HTMLVideoElement>(null)
  const v2 = useRef<HTMLVideoElement>(null)
  const [dur, setDur] = useState(0)
  const hasVideo = !!job.files['source.mp4']
  const hasBones = !!job.files['bones.mp4']
  const hasVrma = !!job.files['motion.vrma']
  const stamp = (n: string) => job.files[n as keyof Job['files']]?.at ?? ''

  useEffect(() => {
    setText(null)
    setT(0)
    setPlaying(false)
  }, [job.id])

  // 時刻をそろえる: 主の時計は画面の時刻 t。動画は t から 0.08 秒より離れたら合わせる
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = (now - prev) / 1000
      prev = now
      setT((x) => {
        const n = x + dt
        return dur && n > dur ? 0 : n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, dur])

  useEffect(() => {
    for (const v of [v1.current, v2.current]) {
      if (!v || !v.duration) continue
      const target = Math.min(t, v.duration - 0.01)
      if (playing) {
        if (v.paused) v.play().catch(() => {})
        if (Math.abs(v.currentTime - target) > 0.08) v.currentTime = target
      } else {
        if (!v.paused) v.pause()
        if (Math.abs(v.currentTime - target) > 0.01) v.currentTime = target
      }
    }
  }, [t, playing])

  const onMeta = () => {
    const ds = [v1.current?.duration, v2.current?.duration].filter((x): x is number => !!x && isFinite(x))
    if (ds.length) setDur(Math.min(...ds))
  }

  const q = job.quality ?? {}
  const downloads = useMemo(
    () =>
      [
        ['source.mp4', '① 元の動画（H3）'],
        ['bones.mp4', '② 骨の動画'],
        ['vrm.mp4', '③ VRM の動画'],
        ['compare.mp4', '3 枠の比較動画'],
        ['motion.vrma', '.vrma'],
        ['bones.glb', '骨（glb）'],
        ['stats.json', '品質の目安（json）'],
      ].filter(([n]) => job.files[n as keyof Job['files']]),
    [job],
  )

  return (
    <>
      <div className="row between">
        <div>
          <h2>
            {job.motion} <span className="mono small muted">{job.id}</span>
          </h2>
          <p className="muted small">
            {job.durationSec} 秒 · {job.aspect} · {JOB_STATE_LABEL[job.state]}
            {job.message ? ` — ${job.message}` : ''} · {PROOF_LABEL[job.proofs.state]}
          </p>
        </div>
        <button onClick={async () => setText((await api.requestText(job.id)).text)}>依頼文</button>
      </div>
      {text && <CopyBox text={text} copy={copyText} />}
      {job.proofs.state === 'failed' && (
        <p className="error small">
          確認用の動画を焼けませんでした: {job.proofs.error} <button onClick={() => api.rebake(job.id)}>焼き直す</button>
        </p>
      )}
      <div className={`panes ${job.aspect === '16:9' ? 'wide' : ''}`}>
        <figure>
          <figcaption>① 元の動画（H3）</figcaption>
          {hasVideo ? <video ref={v1} src={`${fileUrl(job.id, 'source.mp4')}?t=${stamp('source.mp4')}`} muted playsInline preload="auto" onLoadedMetadata={onMeta} /> : <div className="empty muted">まだ無い</div>}
        </figure>
        <figure>
          <figcaption>② 骨（GEM-X）</figcaption>
          {hasBones ? <video ref={v2} src={`${fileUrl(job.id, 'bones.mp4')}?t=${stamp('bones.mp4')}`} muted playsInline preload="auto" onLoadedMetadata={onMeta} /> : <div className="empty muted">{job.files['bones.glb'] ? '骨の動画を焼いています…' : 'まだ無い'}</div>}
        </figure>
        <figure>
          <figcaption>③ VRM</figcaption>
          {hasVrma ? <VrmPane vrmUrl={`api/models/${job.modelId}/model.vrm`} vrmaUrl={`${fileUrl(job.id, 'motion.vrma')}?t=${stamp('motion.vrma')}`} time={t} sourceStartSec={q.sourceStartSec ?? 0} /> : <div className="empty muted">まだ無い</div>}
        </figure>
      </div>
      <div className="transport">
        <button className="primary" onClick={() => setPlaying((p) => !p)} disabled={!hasVideo}>
          {playing ? '止める' : '再生'}
        </button>
        <input
          type="range"
          min={0}
          max={dur || job.durationSec}
          step={1 / 30}
          value={t}
          aria-label="時刻"
          onChange={(e) => {
            setPlaying(false)
            setT(Number(e.target.value))
          }}
        />
        <span className="mono small">
          {t.toFixed(2)} / {(dur || job.durationSec).toFixed(2)} 秒
        </span>
      </div>
      <div className="quality">
        <Metric label="足の滑り" value={q.footSlideCmPerSec} unit="cm/秒" good={3} bad={8} />
        <Metric label="手首の震え" value={q.wristJitter} unit="m/s²" good={3} bad={8} />
        <Metric label="床（いちばん低い所）" value={q.lowestPointMedianCm} unit="cm" good={1.5} bad={4} abs />
        <Metric label="始めと終わりの差" value={q.startEndDeg} unit="°" good={10} bad={30} />
        <span className="chip">seed {job.seed ?? '—'} · 焼き直し {job.retries ?? '—'}</span>
        {q.loop && <span className="chip">ループ</span>}
        {q.inPlace && <span className="chip">その場</span>}
        {q.sourceStartSec ? <span className="chip">元の動画の {q.sourceStartSec} 秒から</span> : null}
      </div>
      {job.findings && (
        <div className="findings">
          <h3>エージェントの所見</h3>
          <p>{job.findings}</p>
        </div>
      )}
      <div className="downloads">
        <h3>ダウンロード</h3>
        <ul>
          {downloads.map(([n, label]) => (
            <li key={n}>
              <a href={fileUrl(job.id, n, true)} download>
                {label}
              </a>{' '}
              <span className="muted small mono">{((job.files[n as keyof Job['files']]?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB</span>
            </li>
          ))}
          {!downloads.length && <li className="muted">まだ無い</li>}
        </ul>
      </div>
      <details className="log">
        <summary>進み具合の記録（{job.log.length}）</summary>
        <ol>
          {job.log.map((e, i) => (
            <li key={i} className="small">
              <span className="mono muted">{new Date(e.at).toLocaleTimeString()}</span> {JOB_STATE_LABEL[e.state]} {e.message ?? ''}
            </li>
          ))}
        </ol>
      </details>
    </>
  )
}

function Metric({ label, value, unit, good, bad, abs }: { label: string; value?: number; unit: string; good: number; bad: number; abs?: boolean }) {
  const v = value === undefined ? undefined : abs ? Math.abs(value) : value
  const cls = v === undefined ? '' : v <= good ? 'ok' : v >= bad ? 'bad' : 'mid'
  return (
    <span className={`metric ${cls}`}>
      <span className="muted small">{label}</span> <strong>{value ?? '—'}</strong> <span className="small">{value !== undefined ? unit : ''}</span>
    </span>
  )
}
