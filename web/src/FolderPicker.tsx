import { useEffect, useRef, useState } from 'react'
import type { DirListing, FolderHint } from '../../server/shared'
import { api } from './api'

const HINT_WORD: Record<FolderHint, string> = { comfyui: 'ComfyUI らしい', gemx: 'GEM-X らしい' }

/** パスの一つ上（文字の上で。/ と \ のどちらにも） */
function parentOf(p: string): string | null {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  if (i < 0) return null
  const up = t.slice(0, i)
  if (!up) return '/'
  return /^[A-Za-z]:$/.test(up) ? `${up}\\` : up
}

/**
 * サーバの側のフォルダを見て回って 1 つ選ぶダイアログ（GET /api/fs/dirs）。
 * 一覧: クリックで選ぶ・ダブルクリック / → で中へ・← / Backspace で上へ・↑↓ で動く・Enter で決定・Esc でやめる
 */
export function FolderPicker({ title, kind, start, onPick, onClose }: { title: string; kind: FolderHint; start: string[]; onPick: (path: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [listing, setListing] = useState<DirListing | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [sel, setSel] = useState(-1)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // パスの欄を書き換え中なら、はじめの読み込みで上書きしない
  const typing = useRef(false)

  const show = (l: DirListing) => {
    setListing(l)
    setPathInput(l.path)
    typing.current = false
    setSel(-1)
    setError('')
  }

  // 読みに行った順の番号。後から頼んだ物の答えだけを出す（遅れて届いた古い答えで上書きしない）
  const seq = useRef(0)

  const go = async (path: string, showHidden = hidden) => {
    const n = ++seq.current
    setLoading(true)
    try {
      const l = await api.dirs(path, showHidden)
      if (n !== seq.current) return
      show(l)
      listRef.current?.focus()
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }

  // 開く: 今の設定の値（無ければ近い上のフォルダ）→ 次の候補 → ホーム
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
    const n = ++seq.current
    ;(async () => {
      setLoading(true)
      for (const s of [...start.filter(Boolean), '']) {
        for (let p: string | null = s; p !== null; p = p ? parentOf(p) : null) {
          if (n !== seq.current) return // 開いている間にほかへ移った
          try {
            const l = await api.dirs(p)
            if (n !== seq.current) return
            if (typing.current) setListing(l)
            else {
              show(l)
              listRef.current?.focus()
            }
            setLoading(false)
            return
          } catch {
            if (!p) break
          }
        }
      }
      if (n === seq.current) {
        setError('はじめのフォルダを開けませんでした。パスを入れて移動してください')
        setLoading(false)
      }
    })()
    return () => {
      seq.current++
    }
  }, [])

  useEffect(() => {
    if (sel >= 0) listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const dirs = listing?.dirs ?? []
  const target = sel >= 0 && dirs[sel] ? dirs[sel] : null
  const chosen = target?.path ?? listing?.path ?? ''
  const chosenHint = target ? target.hints.includes(kind) : !!listing?.hints.includes(kind)

  const decide = () => {
    if (chosen) onPick(chosen)
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (!listing) return
    if (e.key === 'ArrowDown') setSel((i) => Math.min(dirs.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setSel((i) => Math.max(0, i - 1))
    else if (e.key === 'Home') setSel(dirs.length ? 0 : -1)
    else if (e.key === 'End') setSel(dirs.length - 1)
    else if (e.key === 'ArrowRight' && target) go(target.path)
    else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && listing.parent) go(listing.parent)
    else if (e.key === 'Enter') decide()
    else return
    e.preventDefault()
  }

  return (
    <dialog
      ref={dialog}
      className="picker"
      aria-labelledby="picker-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose() // 外側（背景）を押したら閉じる
      }}
    >
      <div className="picker-body">
        <div className="row between">
          <h2 id="picker-title">{title}</h2>
          <button type="button" className="icon" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>

        <nav className="crumbs" aria-label="今のフォルダ">
          {listing?.crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 1 && <span className="sep">{listing.sep}</span>}
              <button type="button" className={i === listing.crumbs.length - 1 ? 'crumb on' : 'crumb'} onClick={() => go(c.path)}>
                {c.name}
              </button>
            </span>
          ))}
          {listing?.hints.includes(kind) && <span className="hint">{HINT_WORD[kind]}</span>}
        </nav>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            go(pathInput)
          }}
        >
          <input className="mono grow" aria-label="パスを入れて移動" value={pathInput} spellCheck={false} onChange={(e) => {
              typing.current = true
              setPathInput(e.target.value)
            }} />
          <button type="submit">
            移動
          </button>
        </form>

        <div className="row wrap">
          <button type="button" disabled={!listing?.parent} onClick={() => listing?.parent && go(listing.parent)}>
            ↑ 上へ
          </button>
          <button type="button" onClick={() => go('~')}>
            ホーム
          </button>
          {(listing?.roots ?? ['/']).map((r) => (
            <button type="button" key={r} onClick={() => go(r)}>
              {r === '/' ? 'ルート /' : r}
            </button>
          ))}
          <label className="row small muted check-inline">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => {
                setHidden(e.target.checked)
                if (listing) go(listing.path, e.target.checked)
              }}
            />
            隠しフォルダも出す{listing && !hidden && listing.hiddenCount ? `（${listing.hiddenCount}）` : ''}
          </label>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <ul
          ref={listRef}
          className="dirlist"
          role="listbox"
          tabIndex={0}
          aria-label="フォルダの一覧"
          aria-activedescendant={sel >= 0 ? `dir-${sel}` : undefined}
          onKeyDown={onListKey}
        >
          {dirs.map((d, i) => (
            <li
              key={d.path}
              id={`dir-${i}`}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'on' : undefined}
              onClick={() => setSel(i === sel ? -1 : i)}
              onDoubleClick={() => go(d.path)}
              title={d.path}
            >
              <svg className="folder" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M1.5 3.5h4.2l1.4 1.5h7.4v8H1.5z" fill="currentColor" />
              </svg>
              <span className="name">{d.name}</span>
              {d.link && <span className="muted small">リンク</span>}
              {d.hints.includes(kind) && <span className="hint">{HINT_WORD[kind]}</span>}
            </li>
          ))}
          {listing && !dirs.length && <li className="muted empty-row">中にフォルダはありません</li>}
          {!listing && loading && <li className="muted empty-row">読んでいます…</li>}
        </ul>
        {listing?.truncated && <p className="muted small">フォルダが多いので、はじめの {dirs.length} 個だけを出しています。パスを入れて移動してください。</p>}
        <p className="muted small">クリックで選ぶ・ダブルクリックか → で中へ・← で上へ・Enter で決定・Esc でやめる</p>

        <div className="picker-foot">
          <div className="chosen">
            <span className="muted small">選ぶフォルダ</span>
            <span className="mono">{chosen || '…'}</span>
            {chosenHint && <span className="hint">{HINT_WORD[kind]}</span>}
          </div>
          <div className="row">
            <button type="button" onClick={onClose}>
              やめる
            </button>
            <button type="button" className="primary" disabled={!chosen || loading} onClick={decide}>
              このフォルダを選ぶ
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
