import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import React, { useState } from 'react'
import { useWeb3 } from '../context/Web3Context'

const API = '/api/v1'

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer aiwork-dev-key-001', ...options.headers },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export default function Disputes() {
  const navigate = useNavigate()
  const { address } = useWeb3()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ taskId: '', reason: '', arbiter1: '', arbiter2: '', arbiter3: '' })
  const [voteForm, setVoteForm] = useState({ disputeId: '', vote: '' })

  // Fetch all disputes (we query by a dummy task or use a list-all approach)
  const { data: disputes, isLoading } = useQuery({
    queryKey: ['disputes'],
    queryFn: async () => {
      // Try to get recent disputes - the API doesn't have a list-all, so we check task-based
      const res = await fetch(`${API}/disputes/task/all`, {
        headers: { Authorization: 'Bearer aiwork-dev-key-001' },
      })
      if (!res.ok) return []
      const data = await res.json()
      return data.disputes || []
    },
    refetchInterval: 10000,
  })

  const openMutation = useMutation({
    mutationFn: (data) => apiFetch('/disputes', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disputes'] })
      setShowForm(false)
      setForm({ taskId: '', reason: '', arbiter1: '', arbiter2: '', arbiter3: '' })
    },
  })

  const voteMutation = useMutation({
    mutationFn: ({ disputeId, arbiterAddress, vote }) =>
      apiFetch(`/disputes/${disputeId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ arbiterAddress, vote }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] }),
  })

  function handleOpen(e) {
    e.preventDefault()
    openMutation.mutate({
      taskId: form.taskId,
      reason: form.reason,
      openerAddress: address || '0x0000000000000000000000000000000000000000',
      arbiters: [form.arbiter1, form.arbiter2, form.arbiter3].filter(Boolean),
    })
  }

  function handleVote(disputeId, vote) {
    voteMutation.mutate({
      disputeId,
      arbiterAddress: address || '0x0000000000000000000000000000000000000000',
      vote,
    })
  }

  const statusColor = (s) => {
    if (s === 'RESOLVED') return 'var(--accent-green)'
    if (s === 'VOTING') return 'var(--accent-amber)'
    if (s === 'CANCELLED') return 'var(--text-dim)'
    return 'var(--accent-cyan)'
  }

  const resolutionLabel = (r) => {
    if (r === 'FAVOR_WORKER') return '✅ Worker wins'
    if (r === 'FAVOR_POSTER') return '✅ Poster wins'
    if (r === 'SPLIT') return '⚖️ Split'
    return '—'
  }

  return (
    <div className="page" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="gradient-text">Dispute Resolution</h2>
        <button
          className="btn-primary"
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: '8px 20px',
            background: showForm ? 'var(--accent-error)' : 'var(--accent-cyan)',
            border: 'none',
            color: '#000',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            cursor: 'pointer',
            borderRadius: '4px',
          }}
        >
          {showForm ? '[ CANCEL ]' : '[ OPEN DISPUTE ]'}
        </button>
      </div>

      <p style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        3-arbiter panel voting · Majority wins · On-chain settlement
      </p>

      {/* Open Dispute Form */}
      {showForm && (
        <form onSubmit={handleOpen} style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          padding: '1.5rem',
          marginBottom: '2rem',
          display: 'grid',
          gap: '1rem',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            [ NEW DISPUTE ]
          </div>

          <div>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginBottom: '4px' }}>
              TASK_ID (bytes32)
            </label>
            <input
              type="text"
              value={form.taskId}
              onChange={(e) => setForm({ ...form, taskId: e.target.value })}
              placeholder="0xabc123..."
              required
              style={{
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginBottom: '4px' }}>
              REASON
            </label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Describe the dispute..."
              required
              rows={3}
              style={{
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            {['arbiter1', 'arbiter2', 'arbiter3'].map((key, i) => (
              <div key={key}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginBottom: '4px' }}>
                  ARBITER_{i + 1}
                </label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder="0x..."
                  required
                  style={{
                    width: '100%',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                  }}
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={openMutation.isPending}
            style={{
              padding: '10px',
              background: 'var(--accent-error)',
              border: 'none',
              color: '#fff',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: openMutation.isPending ? 0.5 : 1,
            }}
          >
            {openMutation.isPending ? '[ SUBMITTING... ]' : '[ SUBMIT DISPUTE ]'}
          </button>

          {openMutation.isError && (
            <div style={{ color: 'var(--accent-error)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              ERR: {openMutation.error?.message}
            </div>
          )}
          {openMutation.isSuccess && (
            <div style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              ✓ Dispute opened — arbiters notified
            </div>
          )}
        </form>
      )}

      {/* Dispute List */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', padding: '3rem' }}>
            [ LOADING DISPUTES... ]
          </div>
        ) : !disputes?.length ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚖️</div>
            <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No active disputes</div>
            <div style={{ fontSize: '0.8rem' }}>Open a dispute to contest a task verification or payment.</div>
          </div>
        ) : (
          disputes.map((d) => (
            <div
              key={d.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                padding: '1.25rem',
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                    #{d.id}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    border: `1px solid ${statusColor(d.status)}`,
                    color: statusColor(d.status),
                  }}>
                    {d.status}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
              </div>

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                Task: {d.task_id?.slice(0, 18)}...
              </div>

              <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                {d.reason}
              </div>

              {/* Arbiters */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {(d.arbiters || []).map((a, i) => (
                  <span key={i} style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: 'var(--accent-purple)',
                    background: 'rgba(139, 92, 246, 0.1)',
                    padding: '2px 8px',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                  }}>
                    Arbiter {i + 1}: {a?.slice(0, 8)}...
                  </span>
                ))}
              </div>

              {/* Votes */}
              {d.votes && d.votes.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>
                    VOTES ({d.votes.length}/3):
                  </div>
                  {d.votes.map((v, i) => (
                    <div key={i} style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      color: v.vote === 'FAVOR_WORKER' ? 'var(--accent-green)' : v.vote === 'FAVOR_POSTER' ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                      padding: '2px 0',
                    }}>
                      {v.arbiter?.slice(0, 10)}... → {v.vote}
                    </div>
                  ))}
                </div>
              )}

              {/* Resolution */}
              {d.status === 'RESOLVED' && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.9rem',
                  color: 'var(--accent-green)',
                  padding: '8px 12px',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                }}>
                  Resolution: {resolutionLabel(d.resolution)}
                </div>
              )}

              {/* Vote Buttons */}
              {d.status === 'VOTING' && address && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  {['FAVOR_WORKER', 'FAVOR_POSTER', 'SPLIT'].map((v) => (
                    <button
                      key={v}
                      onClick={() => handleVote(d.id, v)}
                      disabled={voteMutation.isPending}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: 'transparent',
                        border: `1px solid ${v === 'FAVOR_WORKER' ? 'var(--accent-green)' : v === 'FAVOR_POSTER' ? 'var(--accent-amber)' : 'var(--accent-cyan)'}`,
                        color: v === 'FAVOR_WORKER' ? 'var(--accent-green)' : v === 'FAVOR_POSTER' ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                      }}
                    >
                      {v === 'FAVOR_WORKER' ? '✓ Worker' : v === 'FAVOR_POSTER' ? '✓ Poster' : '⚖ Split'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
