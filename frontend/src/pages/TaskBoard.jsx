import { useState, useEffect } from 'react'
import { fetchTasks } from '../api'

const PHASE_MAP = {
  bidding: { label: 'Bidding', cls: 'bidding', badge: 'badge-purple' },
  BIDDING: { label: 'Bidding', cls: 'bidding', badge: 'badge-purple' },
  POSTED: { label: 'Open', cls: 'bidding', badge: 'badge-purple' },
  assigned: { label: 'Awarded', cls: 'in-progress', badge: 'badge-cyan' },
  AWARDED: { label: '🏆 Awarded', cls: 'in-progress', badge: 'badge-cyan' },
  in_progress: { label: 'Working', cls: 'in-progress', badge: 'badge-cyan' },
  EXECUTING: { label: 'Executing', cls: 'in-progress', badge: 'badge-cyan' },
  SUBMITTED: { label: '📝 Submitted', cls: 'review', badge: 'badge-amber' },
  step_review: { label: 'Review', cls: 'review', badge: 'badge-amber' },
  VERIFIED: { label: '✓ Verified', cls: 'completed', badge: 'badge-green' },
  completed: { label: 'Done', cls: 'completed', badge: 'badge-green' },
  COMPLETED: { label: '✅ Done', cls: 'completed', badge: 'badge-green' },
  PAID: { label: '💰 Paid', cls: 'completed', badge: 'badge-green' },
  rejected: { label: 'Rejected', cls: 'completed', badge: 'badge-red' },
  FAILED: { label: 'Failed', cls: 'completed', badge: 'badge-red' },
  open: { label: 'Open', cls: 'bidding', badge: 'badge-purple' },
}

import { useNavigate } from "@tanstack/react-router"

export default function TaskBoard() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTasks().then(data => {
      if (data) setTasks(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = tasks.filter(t => {
    if (filter !== 'ALL' && t.phase.toUpperCase() !== filter) return false
    if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false
    return true
  })

  return (
    <div className="page">
      <div className="section-header">
        <h2 className="gradient-text">Operations Matrix</h2>
        <p className="section-subtitle">Active execution threads</p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0', justifyContent: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', border: '1px solid var(--border-dim)' }}>
        {['ALL', 'BIDDING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)} style={{ border: 'none', borderRight: '1px solid var(--border-dim)' }}>
            {f === 'ALL' ? 'Global' : f === 'IN_PROGRESS' ? 'Executing' : f}
          </button>
        ))}
        {['CODE', 'NLP', 'DATA', 'VISION'].map(c => (
          <button key={c} className={`btn btn-sm ${categoryFilter === c ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCategoryFilter(c)} style={{ border: 'none', borderRight: '1px solid var(--border-dim)' }}>
            {c}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="task-list">
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', background: 'var(--bg-void)' }}>
            [ LOADING OPERATIONS... ] SYNCING CHAIN_STATE
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', background: 'var(--bg-void)' }}>
            [ SYS_MSG ] Query returned empty array. No operations found.
          </div>
        ) : filtered.map((t) => {
          const phase = PHASE_MAP[t.phase] || { label: t.phase, cls: 'bidding', badge: '' }
          
          let verifiedChunks = 0
          let totalChunks = 0
          if (t.chunks) {
            const parts = t.chunks.split('/')
            verifiedChunks = parseInt(parts[0]) || 0
            totalChunks = parseInt(parts[1]) || 0
          }

          return (
            <div className="task-card" key={t.id} onClick={() => navigate({ to: t.phase === 'bidding' ? '/bid' : '/details', search: { taskId: t.id } })}>
              <div className={`task-phase ${phase.cls}`}></div>
              <div className="task-card-info">
                <div className="task-card-title">{t.title}</div>
                <div className="task-card-meta">
                  <span className="badge">{phase.label}</span>
                  <span className="badge">{t.category}</span>
                  {t.agent && (
                    <>
                      <span className="model-badge">NODE</span>
                      <span className="agent-tag" style={{ border: '1px solid var(--border-dim)', padding: '2px 4px', fontFamily: 'var(--font-mono)' }}>{`${t.agent.slice(0, 6)}...`}</span>
                    </>
                  )}
                  {t.phase === 'bidding' && <span className="task-card-bids">[{t.bids} BIDS]</span>}
                  <span className="agent-tag" style={{fontFamily: 'var(--font-mono)'}}>{`${t.id.slice(0, 6)}...${t.id.slice(-4)}`}</span>
                </div>
                {/* Chunk Timeline */}
                {totalChunks > 0 && (
                  <div className="chunk-timeline" style={{ marginTop: '12px', display: 'flex', gap: '4px' }}>
                    {Array.from({ length: totalChunks }).map((_, i) => (
                      <div
                        key={i}
                        style={{ height: '4px', flex: 1, background: i < verifiedChunks ? 'var(--accent-success)' : i === verifiedChunks && t.phase === 'in_progress' ? 'var(--text-pure)' : 'var(--border-dim)' }}
                        title={`Chunk ${i + 1}`}
                      ></div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="task-card-reward">{t.reward}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '8px' }}>
                  {verifiedChunks}/{totalChunks} chunks
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
