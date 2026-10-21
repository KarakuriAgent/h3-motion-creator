import { useRef, useState } from 'react'

/** 依頼文などのコピーの枠（クリップボードが使えなければ選択する） */
export function CopyBox({ text, copy }: { text: string; copy: (t: string) => Promise<boolean> }) {
  const ref = useRef<HTMLPreElement>(null)
  const [toast, setToast] = useState('')
  const onCopy = async () => {
    if (await copy(text)) setToast('コピーしました')
    else {
      const r = document.createRange()
      r.selectNodeContents(ref.current!)
      const s = getSelection()!
      s.removeAllRanges()
      s.addRange(r)
      setToast('選択しました。Ctrl+C でコピーしてください')
    }
  }
  return (
    <div className="copybox">
      <pre ref={ref}>{text}</pre>
      <div className="row">
        <button className="primary" onClick={onCopy}>
          コピー
        </button>
        <span className="muted small" aria-live="polite">
          {toast}
        </span>
      </div>
    </div>
  )
}
