import { useEffect, useState } from 'react'
import { EnvTab } from './EnvTab'
import { RequestTab } from './RequestTab'
import { ReviewTab } from './ReviewTab'

type Tab = 'env' | 'request' | 'review'
const TABS: [Tab, string][] = [
  ['env', '環境チェック／設定'],
  ['request', '依頼'],
  ['review', '確認'],
]

function initialTab(): Tab {
  const h = location.hash.replace('#', '').split('/')[0]
  return (TABS.find(([t]) => t === h)?.[0] as Tab) ?? 'request'
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  useEffect(() => {
    const on = () => setTab(initialTab())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const go = (t: Tab) => {
    location.hash = t
    setTab(t)
  }
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <strong>h3-motion-creator</strong>
          <span className="muted">VRM → 三面図 → H3 r2v → GEM-X → .vrma</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab on' : 'tab'} onClick={() => go(t)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'env' && <EnvTab />}
        {tab === 'request' && <RequestTab onGoReview={() => go('review')} />}
        {tab === 'review' && <ReviewTab />}
      </main>
      <footer className="foot muted">
        動画の生成は MiniMax H3（MiniMax H3 Community License）・骨の推定は GEM-X（NVIDIA）。モデルの重みは同梱していません。決まりは THIRD_PARTY_NOTICES.md
      </footer>
    </div>
  )
}
