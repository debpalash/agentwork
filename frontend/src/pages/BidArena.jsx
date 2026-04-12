import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchTaskById, fetchBids, submitBid, awardTask } from '../api'
import React, { useState, useEffect } from 'react'
import { useWeb3 } from '../context/Web3Context'

function SandboxTerminal() {
  const [logs, setLogs] = useState([])
  useEffect(() => {
    const rawLogs = [
      '[SYS] Initializing DinD sandbox boundary...',
      '[DIND] Booting isolated container: node:20-alpine',
      '[GIT] Cloning Forgejo repository repo/AIWK-task-0xb1c4...',
      '[BUN] Resolving dependencies via bun.lockb...',
      '[BUN] 142 packages installed in 0.4s',
      '[TEST] Running test suite for Chunk 1: Data Preprocessing',
      '[TEST] ✔ cleaning.test.ts (24ms)',
      '[TEST] ✔ normalization.test.ts (11ms)',
      '[SYS] Chunk 1 execution verified. Quality matrix: 98% passed.',
      '[CHAIN] Emitting verifyChunk() to EscrowVault contract...',
      '[CHAIN] Transaction confirmed (0xfa9b...). Escrow released for Chunk 1.'
    ]
    let i = 0
    const interval = setInterval(() => {
      setLogs(prev => [...prev, rawLogs[i]])
      i++
      if (i >= rawLogs.length) clearInterval(interval)
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="tty-terminal">
      <div className="tty-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>[ SYSTEM.TTY.01 ] Sandbox Initialized</span>
        <span>SIG: OK</span>
      </div>
      <div style={{ height: '180px', overflowY: 'auto' }}>
        {logs.map((L, i) => (
          <div key={i} style={{ padding: '2px 0' }}>{L}</div>
        ))}
        {logs.length < 11 && <div style={{ animation: 'flash 1s infinite' }}>_</div>}
      </div>
    </div>
  )
}

export default function BidArena() {
  const navigate = useNavigate()
  const { taskId } = useSearch({ strict: false }) || {}
  const { address } = useWeb3()
  const [amount, setAmount] = useState('')
  const queryClient = useQueryClient()
  const [countdown, setCountdown] = useState(14400) // Mock countdown 4h

  // Load Task
  const { data: TASK, isLoading: taskLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTaskById(taskId),
    enabled: !!taskId
  })

  // Load Bids
  const { data: BIDS, isLoading: bidsLoading } = useQuery({
    queryKey: ['bids', taskId],
    queryFn: () => fetchBids(taskId),
    enabled: !!taskId
  })

  const mutation = useMutation({
    mutationFn: (newBid) => submitBid(taskId, newBid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bids', taskId] })
      setAmount('')
    }
  })

  const awardMutation = useMutation({
    mutationFn: () => awardTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      queryClient.invalidateQueries({ queryKey: ['bids', taskId] })
    }
  })
  
  const submitMyBid = (e) => {
    e.preventDefault()
    if (!amount || !address) return
    mutation.mutate({
      agentAddress: address,
      amount,
    })
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (s) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  if (!taskId) return <div className="page" style={{ padding: '3rem', textAlign: 'center', color: 'var(--accent-error)' }}>[ ERR ] No taskId parameter provided.</div>
  
  if (taskLoading) return <div className="page" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>[ LOADING... ] SYNCING BID ARENA FOR_ID={taskId}</div>

  if (!TASK) return <div className="page" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)' }}>[ ERR ] Task could not be loaded.</div>

  const safeBids = Array.isArray(BIDS) ? BIDS : (BIDS?.bids || [])

  return (
    <div className="page" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div className="section-header">
        <h2 className="gradient-text">Operations Detail & Bid Interface</h2>
        <p className="section-subtitle">Tender evaluation and thread execution</p>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: '1rem', fontFamily: 'var(--font-mono)' }} onClick={() => navigate({ to: '/tasks' })}>← Return to Matrix</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: '1px', background: 'var(--border-dim)' }}>
        {/* Left: Task Spec */}
        <div style={{ background: 'var(--bg-void)' }}>
          <div className="panel" style={{ border: 'none', height: '100%' }}>
            <div className="panel-header">
              <span className="panel-title">[ PROTOCOL SPECS ]</span>
              <span className="badge" style={{
                background: TASK.phase === 'AWARDED' || TASK.phase === 'COMPLETED' ? 'var(--accent-green)' : 
                            TASK.phase === 'SUBMITTED' ? 'var(--accent-amber)' : 'transparent',
                color: TASK.phase === 'AWARDED' || TASK.phase === 'COMPLETED' || TASK.phase === 'SUBMITTED' ? 'var(--bg-void)' : 'var(--text-dim)',
              }}>{TASK.phase === 'AWARDED' ? '🏆 AWARDED' : TASK.phase === 'COMPLETED' ? '✅ COMPLETED' : TASK.phase === 'SUBMITTED' ? '📝 SUBMITTED' : TASK.phase === 'VERIFIED' ? '✓ VERIFIED' : 'STATUS: BIDDING'}</span>
            </div>
            <div className="panel-body" style={{ padding: '24px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>ID: {TASK.id}</div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', fontFamily: 'var(--font-bold)', color: 'var(--text-pure)' }}>{TASK.title}</h3>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', fontFamily: 'var(--font-mono)' }}>
                <span className="badge">SEC: {TASK.category}</span>
                <span className="badge">MAX_BID: {TASK.budget}</span>
                <span className="badge">DEADLINE: {TASK.deadline ? new Date(parseInt(TASK.deadline) * 1000).toLocaleString() : 'N/A'}</span>
              </div>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-bright)', lineHeight: 1.6, marginBottom: '2rem' }}>{TASK.description || 'No description provided.'}</p>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: '1rem', borderBottom: '1px solid var(--border-dim)', paddingBottom: '0.5rem' }}>// Execution Chunks</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {(TASK.chunkDescriptions || Array.from({ length: parseInt(TASK.chunks?.split('/')[1] || 1) }).map((_, i) => `Execution step ${i + 1}`)).map((chunk, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px dashed var(--border-dim)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', width: '30px' }}>[{i + 1}]</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-bright)', fontFamily: 'var(--font-mono)' }}>{chunk}</span>
                  </li>
                ))}
              </ul>

              {/* Countdown inside left panel */}
              {TASK.phase === 'bidding' && (
                <div style={{ marginTop: '3rem', border: '1px solid var(--border-dim)', background: 'var(--bg-mid)', padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}>TIME TO LOCK</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2.5rem', color: 'var(--text-pure)', fontWeight: 700 }}>
                    {formatTime(countdown)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Bid Leaderboard + Terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border-dim)' }}>

          {/* Place a Bid */}
          <div className="panel" style={{ border: 'none', background: 'var(--bg-void)' }}>
            <div className="panel-header"><span className="panel-title">[ execute_bid ]</span></div>
            <div className="panel-body" style={{ padding: '24px' }}>
              {(TASK.phase === 'AWARDED' || TASK.phase === 'COMPLETED' || TASK.phase === 'VERIFIED') ? (
                <div style={{ textAlign: 'center', padding: '1.5rem', border: '1px solid var(--accent-green)', background: 'rgba(0,255,128,0.03)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--accent-green)', marginBottom: '0.5rem' }}>
                    {TASK.phase === 'COMPLETED' ? '✅ TASK COMPLETED' : TASK.phase === 'VERIFIED' ? '✓ VERIFICATION PASSED' : '🏆 TASK AWARDED'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Worker: {TASK.worker_agent?.slice(0, 16) || 'assigned'}...
                  </div>
                  {TASK.awarded_price && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', color: 'var(--text-pure)', marginTop: '0.5rem' }}>{TASK.awarded_price} AIWK</div>}
                </div>
              ) : (
                <form onSubmit={submitMyBid}>
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block' }}>Bid Amount (AIWK)</label>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent-cyan)' }}>Max Ask: {TASK.budget}</span>
                    </div>
                    <input 
                      className="input-text" 
                      type="number" 
                      placeholder="e.g. 1500" 
                      value={amount} 
                      onChange={e => setAmount(e.target.value)}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', padding: '12px', width: '100%' }}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-full" disabled={!address || mutation.isPending}>
                    {mutation.isPending ? '[ SUBMITTING... ]' : !address ? '[ CONNECT WALLET TO BID ]' : '[ SUBMIT PROPOSAL ]'}
                  </button>
                  {mutation.isError && <div style={{ color: 'var(--accent-error)', fontSize: '0.8rem', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>[ ERR ] {mutation.error.message}</div>}
                </form>
              )}
            </div>
          </div>
          
          {/* Bid Registry */}
          <div className="panel" style={{ border: 'none', background: 'var(--bg-void)', flex: 1 }}>
            <div className="panel-header">
              <span className="panel-title">[ BID REGISTRY ]</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>N={safeBids.length}</span>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              {bidsLoading && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>LOADING BIDS...</div>}
              {!bidsLoading && safeBids.length === 0 && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>NO BIDS PLACED</div>}
              {safeBids.map((bid, i) => (
                <div className={`task-card ${i === 0 ? 'winner' : ''}`} key={i} style={{ borderBottom: '1px solid var(--border-dim)', padding: '1rem 1.5rem', margin: 0, border: 'none' }}>
                  <div className="bid-rank" style={{ width: '40px', fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, color: i === 0 ? 'var(--text-pure)' : 'var(--text-dim)' }}>0{i + 1}</div>
                  <div className="task-card-info" style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span className="agent-tag" style={{ color: 'var(--text-pure)', fontWeight: 700, border: '1px solid var(--text-pure)', padding: '2px 4px' }}>
                        {bid.agentAddress?.slice(0, 10)}...{bid.agentAddress?.slice(-4)}
                      </span>
                    </div>
                    <div className="task-card-meta">
                      <span title="Ask">ASK: {bid.amount}</span>
                      <span title="Trust Core">REP: {bid.agentReputation || 'NEW'}</span>
                      <span title="Submitted">TIME: {new Date(bid.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <div className="task-card-reward" style={{ fontSize: '1.25rem', color: i === 0 ? 'var(--text-pure)' : 'var(--text-mid)', textAlign: 'right' }}>
                    {bid.amount} AIWK
                    <div style={{ marginTop: '8px' }}>
                      {bid.is_awarded ? (
                        <span className="badge" style={{ background: 'var(--accent-green)', color: 'var(--bg-void)', fontWeight: 700 }}>🏆 WINNER</span>
                      ) : TASK.phase === 'AWARDED' || TASK.phase === 'COMPLETED' ? (
                        <span className="badge" style={{ opacity: 0.4 }}>[ OUTBID ]</span>
                      ) : (
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ fontSize: '0.65rem' }}
                          onClick={() => awardMutation.mutate()}
                          disabled={awardMutation.isPending}
                        >
                          {awardMutation.isPending ? '[ AWARDING... ]' : '[ AWARD ]'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div style={{ background: 'var(--bg-void)' }}>
            <SandboxTerminal />
          </div>
        </div>
      </div>
    </div>
  )
}
