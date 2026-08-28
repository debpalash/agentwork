import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchTaskById, fetchBids, fetchAgentByWallet, submitBid, awardTask } from '../api'
import { useState, useEffect, type FormEvent } from 'react'
import { useWeb3 } from '../context/Web3Context'
import AsyncState from '../components/AsyncState'
import type { MutationResult } from '../types'

function VerificationPolicy() {
  return (
    <section className="verification-policy" aria-labelledby="verification-policy-title">
      <div className="verification-policy-header">
        <h3 id="verification-policy-title">Verification policy</h3>
        <span className="badge">Fails closed</span>
      </div>
      <ol className="verification-steps">
        <li>Awarded builder pushes a full Git commit SHA.</li>
        <li>A sandbox checks out that commit and runs the task-owned tests.</li>
        <li>Passing evidence moves the task to funder approval.</li>
        <li>Only finalized on-chain approval releases escrow.</li>
      </ol>
    </section>
  )
}

export default function BidArena() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { taskId?: string }
  const taskId = search.taskId
  const { address, walletClient } = useWeb3()
  const [amount, setAmount] = useState('')
  const queryClient = useQueryClient()
  const [countdown, setCountdown] = useState(0)

  // Load Task
  const { data: TASK, isLoading: taskLoading, isError: taskError, error: taskFailure, refetch: refetchTask } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTaskById(taskId as string),
    enabled: !!taskId
  })

  // Load Bids
  const { data: BIDS, isLoading: bidsLoading, isError: bidsError, error: bidsFailure, refetch: refetchBids } = useQuery({
    queryKey: ['bids', taskId],
    queryFn: () => fetchBids(taskId as string),
    enabled: !!taskId
  })

  const { data: myAgent, isError: agentError, error: agentFailure, refetch: refetchAgent } = useQuery({
    queryKey: ['agent-wallet', address],
    queryFn: () => fetchAgentByWallet(address as string),
    enabled: !!address,
  })

  const mutation = useMutation<MutationResult, Error, { agentAddress: string; agentId: string; amount: string; estimatedHours?: number }>({
    mutationFn: newBid => submitBid(taskId as string, newBid, { walletClient, address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bids', taskId] })
      setAmount('')
    }
  })

  const awardMutation = useMutation<MutationResult, Error, void>({
    mutationFn: () => awardTask(taskId as string, { walletClient, address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      queryClient.invalidateQueries({ queryKey: ['bids', taskId] })
    }
  })
  
  const submitMyBid = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!amount || !address || !walletClient || !myAgent?.registered || myAgent.status !== 'ACTIVE') return
    mutation.mutate({
      agentAddress: address,
      agentId: myAgent.agentId,
      amount,
    })
  }

  useEffect(() => {
    const update = () => setCountdown(TASK?.deadline ? Math.max(0, Number(TASK.deadline) - Math.floor(Date.now() / 1000)) : 0)
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [TASK?.deadline])

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  if (!taskId) return <div className="page"><AsyncState kind="error" title="No task selected" message="Choose a task before reviewing or submitting bids." /></div>
  
  if (taskLoading) return <div className="page"><AsyncState kind="loading" title="Loading task bids" message={`Task ${taskId}`} /></div>

  if (taskError) return <div className="page"><AsyncState kind="error" title="Task could not be loaded" message={taskFailure.message} onRetry={refetchTask} /></div>

  if (!TASK) return <div className="page"><AsyncState kind="error" title="Task could not be loaded" /></div>

  const safeBids = BIDS?.bids || []
  const taskPhase = String(TASK.phase || TASK.status || 'UNKNOWN').toUpperCase()
  const biddingPhase = ['OPEN', 'POSTED', 'BIDDING'].includes(taskPhase)
  const reviewPhase = taskPhase === 'STEP_REVIEW'
  const failedTerminal = ['CANCELLED', 'EXPIRED'].includes(taskPhase)

  return (
    <div className="page" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div className="section-header section-header-left">
        <span className="eyebrow">Task market</span>
        <h1>Task bids and award</h1>
        <p className="section-subtitle">Review requirements, submit a builder bid, or inspect the award state.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate({ to: '/tasks' })}>Back to tasks</button>
      </div>

      <div className="bid-layout" style={{ gap: '1px', background: 'var(--border-dim)' }}>
        {/* Left: Task Spec */}
        <div style={{ background: 'var(--bg-void)' }}>
          <div className="panel" style={{ border: 'none', height: '100%' }}>
            <div className="panel-header">
              <span className="panel-title">Task requirements</span>
              <span className="badge" style={{
                background: taskPhase === 'COMPLETED' ? 'var(--accent-success)' : failedTerminal ? 'var(--accent-error)' : reviewPhase ? 'var(--accent-warn)' : 'transparent',
                color: taskPhase === 'COMPLETED' || failedTerminal || reviewPhase ? 'var(--bg-void)' : 'var(--text-dim)',
              }}>{taskPhase.replaceAll('_', ' ')}</span>
            </div>
            <div className="panel-body" style={{ padding: '24px' }}>
              <div className="mono-value detail-id">Task {TASK.id}</div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', fontFamily: 'var(--font-body)', color: 'var(--text-pure)' }}>{TASK.title}</h3>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', fontFamily: 'var(--font-mono)' }}>
                <span className="badge">{TASK.category}</span>
                <span className="badge">Maximum bid {TASK.budget}</span>
                <span className="badge">Due {TASK.deadline ? new Date(Number(TASK.deadline) * 1000).toLocaleString() : 'Not set'}</span>
              </div>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-bright)', lineHeight: 1.6, marginBottom: '2rem' }}>{TASK.description || 'No description provided.'}</p>

              <div className="content-label">Milestones</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {(TASK.chunkDescriptions || Array.from({ length: Number(String(TASK.chunks || '1').split('/')[1] || 1) }).map((_, i) => `Execution step ${i + 1}`)).map((chunk, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px dashed var(--border-dim)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', width: '30px' }}>[{i + 1}]</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-bright)', fontFamily: 'var(--font-mono)' }}>{chunk}</span>
                  </li>
                ))}
              </ul>

              {/* Countdown inside left panel */}
              {TASK.deadline && countdown > 0 && (
                <div style={{ marginTop: '3rem', border: '1px solid var(--border-dim)', background: 'var(--bg-surface)', padding: '1.5rem', textAlign: 'center' }}>
                  <div className="content-label">Time remaining</div>
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
            <div className="panel-header"><span className="panel-title">Submit a bid</span></div>
            <div className="panel-body" style={{ padding: '24px' }}>
              {!biddingPhase ? (
                <div style={{ textAlign: 'center', padding: '1.5rem', border: '1px solid var(--accent-success)', background: 'rgba(0,255,128,0.03)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--accent-success)', marginBottom: '0.5rem' }}>
                    {taskPhase === 'COMPLETED' ? 'Task completed' : `Task ${taskPhase.replaceAll('_', ' ').toLowerCase()}`}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Builder: {TASK.worker_agent?.slice(0, 16) || 'assigned'}...
                  </div>
                  {TASK.awarded_price && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', color: 'var(--text-pure)', marginTop: '0.5rem' }}>{TASK.awarded_price} AIWK</div>}
                </div>
              ) : (
                <form onSubmit={submitMyBid}>
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label htmlFor="bid-amount" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block' }}>Bid amount (AIWK)</label>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--accent-muted-cyan)' }}>Max ask: {TASK.budget}</span>
                    </div>
                    <input 
                      id="bid-amount"
                      name="amount"
                      className="input-text"
                      type="number"
                      min="0"
                      step="0.000001"
                      required
                      placeholder="e.g. 1500" 
                      value={amount} 
                      onChange={e => setAmount(e.target.value)}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', padding: '12px', width: '100%' }}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-full" disabled={!address || !walletClient || !myAgent?.registered || myAgent.status !== 'ACTIVE' || mutation.isPending}>
                    {mutation.isPending ? 'Submitting bid' : !address ? 'Connect wallet to bid' : !myAgent?.registered ? 'Register builder to bid' : myAgent.status !== 'ACTIVE' ? `Builder ${myAgent.status.toLowerCase()}` : 'Submit bid'}
                  </button>
                  {agentError && <AsyncState kind="error" title="Agent eligibility unavailable" message={agentFailure.message} onRetry={refetchAgent} />}
                  {mutation.isError && <div role="alert" style={{ color: 'var(--accent-error)', fontSize: '0.8rem', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>Error: {mutation.error.message}</div>}
                </form>
              )}
            </div>
          </div>
          
          {/* Bid Registry */}
          <div className="panel" style={{ border: 'none', background: 'var(--bg-void)', flex: 1 }}>
            <div className="panel-header">
              <span className="panel-title">Bid registry</span>
              <span className="panel-count">{safeBids.length} {safeBids.length === 1 ? 'bid' : 'bids'}</span>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              {bidsLoading && <AsyncState kind="loading" title="Loading bids" />}
              {bidsError && <AsyncState kind="error" title="Bid registry unavailable" message={bidsFailure.message} onRetry={refetchBids} />}
              {!bidsLoading && !bidsError && safeBids.length === 0 && <AsyncState kind="empty" title="No bids placed" />}
              {safeBids.map((bid, i) => (
                <div className={`task-card ${bid.isAwarded ? 'winner' : ''}`} key={i} style={{ borderBottom: '1px solid var(--border-dim)', padding: '1rem 1.5rem', margin: 0, border: 'none' }}>
                  <div className="bid-rank" style={{ width: '40px', fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, color: bid.isAwarded ? 'var(--text-pure)' : 'var(--text-dim)' }}>0{i + 1}</div>
                  <div className="task-card-info" style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span className="agent-tag" style={{ color: 'var(--text-pure)', fontWeight: 700, border: '1px solid var(--text-pure)', padding: '2px 4px' }}>
                        {bid.agentAddress?.slice(0, 10)}...{bid.agentAddress?.slice(-4)}
                      </span>
                    </div>
                    <div className="task-card-meta">
                      <span title="Ask">Ask {bid.amount}</span>
                      <span title="Reputation">Reputation {bid.agentReputation || 'New'}</span>
                      <span title="Submitted">Submitted {bid.timestamp ? new Date(bid.timestamp).toLocaleTimeString() : 'unknown'}</span>
                    </div>
                  </div>
                  <div className="task-card-reward" style={{ fontSize: '1.25rem', color: bid.isAwarded ? 'var(--text-pure)' : 'var(--text-mid)', textAlign: 'right' }}>
                    {bid.amount} AIWK
                    <div style={{ marginTop: '8px' }}>
                      {bid.isAwarded ? (
                        <span className="badge badge-success">Awarded builder</span>
                      ) : !biddingPhase ? (
                        <span className="badge" style={{ opacity: 0.65 }}>Not awarded</span>
                      ) : (
                        address?.toLowerCase() === TASK.poster?.toLowerCase() && BIDS?.biddingOpen === false && <button
                          className="btn btn-ghost btn-sm" 
                          style={{ fontSize: '0.65rem' }}
                          onClick={() => awardMutation.mutate()}
                          disabled={awardMutation.isPending}
                        >
                          {awardMutation.isPending ? 'Awarding task' : 'Award task'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {awardMutation.isError && <div role="alert" className="problem-notice error">Award failed: {awardMutation.error.message}</div>}
            </div>
          </div>
          
          <div style={{ background: 'var(--bg-void)' }}>
            <VerificationPolicy />
          </div>
        </div>
      </div>
    </div>
  )
}
