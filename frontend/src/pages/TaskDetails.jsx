import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchTaskById } from '../api'
import React from 'react'

export default function TaskDetails() {
  const navigate = useNavigate()
  const { taskId } = useSearch({ strict: false }) || {}

  const { data: t, isLoading, error } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTaskById(taskId),
    enabled: !!taskId
  })

  if (!taskId) {
    return (
      <div className="page" style={{ padding: '3rem', textAlign: 'center', color: 'var(--accent-error)' }}>
        [ ERR ] No taskId parameter provided.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="page" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        [ LOADING... ] SYNCING TASK STATE FOR_ID={taskId}
      </div>
    )
  }

  if (error || !t) {
    return (
      <div className="page" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)' }}>
        [ ERR ] Could not load protocol details. Either it failed or it does not exist.
        <button className="btn btn-secondary btn-sm" style={{ marginTop: '1rem', display: 'block', margin: '1rem auto' }} onClick={() => navigate({ to: '/tasks' })}>← Return to Matrix</button>
      </div>
    )
  }

  // Parse chunks (e.g. "0/5" format)
  let verifiedChunks = 0
  let totalChunks = 0
  if (t.chunks) {
    const parts = t.chunks.split('/')
    verifiedChunks = parseInt(parts[0]) || 0
    totalChunks = parseInt(parts[1]) || 0
  }

  const chunksList = t.chunkDescriptions || Array.from({ length: totalChunks }).map((_, i) => `Execution step ${i + 1}`)

  return (
    <div className="page" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div className="section-header">
        <h2 className="gradient-text">Protocol Details</h2>
        <p className="section-subtitle">ID: {t.id}</p>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: '1rem', fontFamily: 'var(--font-mono)' }} onClick={() => navigate({ to: '/tasks' })}>← Return to Matrix</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '1px', background: 'var(--border-dim)', border: '1px solid var(--border-dim)' }}>
        
        {/* Main Details Panel */}
        <div style={{ background: 'var(--bg-void)' }}>
          <div className="panel" style={{ border: 'none', height: '100%' }}>
            <div className="panel-header">
              <span className="panel-title">[ LOGIC SPECIFICATION ]</span>
              <span className="badge" style={{ background: t.phase === 'completed' ? 'var(--accent-success)' : 'var(--accent-muted-cyan)', color: 'var(--bg-void)' }}>
                STATE: {t.phase?.toUpperCase()}
              </span>
            </div>
            <div className="panel-body" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontFamily: 'var(--font-bold)', color: 'var(--text-pure)' }}>{t.title}</h3>
              
              <div style={{ display: 'flex', gap: '8px', marginBottom: '2rem' }}>
                <span className="badge" style={{ fontFamily: 'var(--font-mono)' }}>SEC: {t.category}</span>
                <span className="badge" style={{ fontFamily: 'var(--font-mono)' }}>RWD: {t.reward || t.budget}</span>
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-dim)', paddingBottom: '0.5rem' }}>// Description</div>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-bright)', lineHeight: 1.6, marginBottom: '2rem' }}>{t.description || 'No description provided.'}</p>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: '1rem', borderBottom: '1px solid var(--border-dim)', paddingBottom: '0.5rem' }}>// Milestone Chunks ({verifiedChunks}/{totalChunks})</div>
              
              <div className="chunk-timeline" style={{ marginBottom: '1.5rem', display: 'flex', gap: '4px' }}>
                {Array.from({ length: totalChunks }).map((_, i) => (
                  <div
                    key={i}
                    style={{ height: '8px', flex: 1, background: i < verifiedChunks ? 'var(--accent-success)' : i === verifiedChunks && t.phase === 'in_progress' ? 'var(--text-pure)' : 'var(--border-dim)' }}
                    title={`Chunk ${i + 1}`}
                  ></div>
                ))}
              </div>
              <ul style={{ listStyle: 'none', margin: '0 0 2rem 0', padding: 0 }}>
                {chunksList.map((chunk, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '8px 0', borderBottom: '1px dashed var(--border-dim)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', width: '30px', paddingTop: '2px' }}>[{i + 1}]</span>
                    <span style={{ fontSize: '0.85rem', color: i < verifiedChunks ? 'var(--accent-success)' : 'var(--text-bright)', fontFamily: 'var(--font-mono)', filter: i < verifiedChunks ? 'brightness(0.8)' : 'none' }}>
                      {chunk}
                      {i < verifiedChunks && ' ✓ VERIFIED'}
                    </span>
                  </li>
                ))}
              </ul>

              {t.phase === 'bidding' && (
                <button className="btn btn-primary btn-full" onClick={() => navigate({ to: '/bid', search: { taskId: t.id } })}>
                  [ VIEW BID REGISTRY ]
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Node & Chain Panel */}
        <div style={{ background: 'var(--bg-void)' }}>
          <div className="panel" style={{ border: 'none', height: '100%' }}>
            <div className="panel-header">
              <span className="panel-title">[ EXECUTION SYSTEM ]</span>
            </div>
            <div className="panel-body" style={{ padding: '24px' }}>
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}>ASSIGNED NEURAL NODE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: t.agent ? 'var(--accent-success)' : 'var(--text-dim)', padding: '12px', border: `1px solid var(--border-dim)`, background: 'var(--bg-mid)', wordBreak: 'break-all' }}>
                  {t.agent || 'AWAITING_SUBCONTRACTOR'}
                </div>
              </div>

              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}>POSTING WALLET</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-mid)', padding: '12px', border: '1px solid var(--border-dim)', background: 'var(--bg-mid)', wordBreak: 'break-all' }}>
                  {t.poster || 'UNKNOWN'}
                </div>
              </div>

              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}>REPOSITORY TARGET</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-muted-cyan)', padding: '12px', border: '1px solid var(--border-dim)', background: 'var(--bg-mid)', wordBreak: 'break-all' }}>
                  {t.repo || 'NULL_REFERENCE'}
                </div>
              </div>

              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}>SLA DEADLINE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-bright)', padding: '12px', border: '1px dashed var(--border-dim)' }}>
                  {t.deadline ? new Date(parseInt(t.deadline || 0) * 1000).toLocaleString() : 'N/A'}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ padding: '12px', border: '1px solid var(--border-dim)', background: 'var(--bg-mid)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>MAX_BUDGET</div>
                  <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{t.budget}</div>
                </div>
                <div style={{ padding: '12px', border: '1px solid var(--border-dim)', background: 'var(--bg-mid)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>BONUS_POOL</div>
                  <div style={{ marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>{t.bonusPool}</div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
