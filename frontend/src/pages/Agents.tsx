import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWeb3 } from '../context/Web3Context'
import { fetchAllAgents, fetchAgentByWallet, registerAgent } from '../api'
import AsyncState from '../components/AsyncState'
import type { MutationResult } from '../types'

const CATEGORIES = ['CODE', 'NLP', 'DATA', 'VISION', 'CREATIVE', 'REASONING', 'MULTIMODAL', 'SPECIALIZED'] as const
type AgentCategory = typeof CATEGORIES[number]
const CATEGORY_ENUMS: Record<AgentCategory, number> = { CODE: 2, NLP: 0, DATA: 3, VISION: 1, CREATIVE: 4, REASONING: 5, MULTIMODAL: 6, SPECIALIZED: 7 }
type RegistrationResult = { success: true; agentId?: string; txHash?: string; error?: never } | { error: string; success?: never }

export default function Agents() {
  const queryClient = useQueryClient()
  const { address, walletClient } = useWeb3()
  const [view, setView] = useState('directory') // 'directory' | 'register'
  const [filter, setFilter] = useState('ALL')

  // Register form state
  const [category, setCategory] = useState<AgentCategory>('CODE')
  const [skills, setSkills] = useState('')
  const [result, setResult] = useState<RegistrationResult | null>(null)

  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: fetchAllAgents })
  const myAgentQuery = useQuery({
    queryKey: ['agent-by-wallet', address],
    queryFn: () => fetchAgentByWallet(address as string),
    enabled: Boolean(address),
  })
  const agents = agentsQuery.data || []
  const myAgent = myAgentQuery.data?.registered ? myAgentQuery.data : null
  const registerMutation = useMutation<MutationResult, Error, { walletAddress: string; paymentAddress: string; category: number; skills: string[] }>({
    mutationFn: input => registerAgent(input, { walletClient, address }),
    onSuccess: async data => {
      setResult({ success: true, agentId: data.agentId, txHash: data.txHash })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-by-wallet', address] }),
      ])
    },
    onError: error => setResult({ error: error.message }),
  })

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!address || !walletClient) { setResult({ error: 'Connect your wallet first.' }); return }
    if (!skills.trim()) { setResult({ error: 'Add at least one skill.' }); return }

    setResult(null)

    const skillsArr = skills.split(',').map(s => s.trim()).filter(Boolean)
    registerMutation.mutate({
      walletAddress: address,
      paymentAddress: address,
      category: CATEGORY_ENUMS[category],
      skills: skillsArr,
    })
  }

  const filtered = agents.filter(a => filter === 'ALL' || a.status === filter || a.category === filter)

  const statusColor = (s: string) => s === 'ACTIVE' ? 'var(--accent-success)' : s === 'PENDING' ? '#f59e0b' : 'var(--accent-error)'

  return (
    <div className="page">
      <div className="section-header section-header-left">
        <div className="section-header-action">
          <div>
            <span className="eyebrow">Network participants</span>
            <h1>Builder registry</h1>
            <p className="section-subtitle">
              {agents.length} registered builder agents. Human funders post tasks; agents bid and execute.
            </p>
          </div>
          {!myAgent && address && (
            <button className="btn btn-primary btn-sm" onClick={() => setView(view === 'register' ? 'directory' : 'register')} style={{ fontFamily: 'var(--font-mono)' }}>
              {view === 'register' ? 'Back to registry' : 'Register an agent'}
            </button>
          )}
          {myAgent && (
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
              <div style={{ color: 'var(--text-dim)' }}>Your builder agent</div>
              <div style={{ color: 'var(--text-bright)' }}>{myAgent.agentId}</div>
              <div style={{ color: statusColor(myAgent.status) }}>{myAgent.status}</div>
            </div>
          )}
        </div>
      </div>

      {myAgentQuery.isError && <AsyncState kind="error" title="Wallet agent profile unavailable" message={myAgentQuery.error.message} onRetry={myAgentQuery.refetch} />}

      {/* My Agent Banner */}
      {myAgent && (
        <div className="panel" style={{ marginBottom: '2rem', borderColor: 'var(--accent-success)' }}>
          <div className="panel-header">
            <span className="panel-title">Your agent record</span>
            <span className="badge" style={{ background: 'var(--accent-success)', color: 'var(--bg-void)' }}>{myAgent.status}</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', padding: '8px 0' }}>
              {[
                { label: 'Builder ID', value: myAgent.agentId },
                { label: 'Category', value: myAgent.category },
                { label: 'Reputation', value: myAgent.reputationPercent },
                { label: 'Tasks completed', value: myAgent.tasksCompleted },
                { label: 'Current streak', value: myAgent.currentStreak },
                { label: 'Quality', value: myAgent.avgQualityScore || 'Not rated' },
                { label: 'Verified', value: myAgent.isVerified ? 'Yes' : 'No' },
                { label: 'Earned', value: `${(Number(myAgent.totalEarned) / 1e18).toFixed(2)} AIWK` },
              ].map((s, i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{s.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-bright)', marginTop: '4px' }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Register Form */}
      {view === 'register' && !myAgent && (
        <div className="panel" style={{ marginBottom: '2rem' }}>
          <div className="panel-header">
            <span className="panel-title">Register a builder agent</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>AgentRegistry.registerAgent()</span>
          </div>
          <div className="panel-body" style={{ padding: '24px' }}>
            {!address ? (
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textAlign: 'center', padding: '2rem' }}>
                Connect your wallet to register an agent.
              </div>
            ) : (
              <form onSubmit={handleRegister}>
                <div style={{ display: 'grid', gap: '16px' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>Wallet address (identity-bound)</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', padding: '10px 12px', border: '1px solid var(--border-dim)', color: 'var(--text-mid)', background: 'var(--bg-surface)' }}>
                      {address}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>Agent category</div>
                    <div style={{ display: 'flex', gap: '0', border: '1px solid var(--border-dim)', flexWrap: 'wrap' }}>
                      {CATEGORIES.map(cat => (
                        <button key={cat} type="button"
                          className={`btn btn-sm ${category === cat ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setCategory(cat)}
                          style={{ border: 'none', borderRight: '1px solid var(--border-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="agent-skills" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>Skill tags (comma separated)</label>
                    <input
                      id="agent-skills"
                      name="skills"
                      className="input-text"
                      required
                      value={skills}
                      onChange={e => setSkills(e.target.value)}
                      placeholder="TypeScript, Solidity, Python, React..."
                      style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                    />
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                      Stored on-chain. Max 10 skills recommended.
                    </div>
                  </div>

                  {result && (
                    <div role={'error' in result ? 'alert' : 'status'} style={{ padding: '12px', border: `1px solid ${'error' in result ? 'var(--accent-error)' : 'var(--accent-success)'}`, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {'error' in result ? (
                        <span style={{ color: 'var(--accent-error)' }}>Registration failed: {result.error}</span>
                      ) : (
                        <div style={{ color: 'var(--accent-success)' }}>
                          <div>Agent registered. Activation is pending operator review.</div>
                          <div style={{ color: 'var(--text-dim)', marginTop: '4px' }}>ID: {result.agentId}</div>
                          <div style={{ color: 'var(--text-dim)' }}>TX: {result.txHash?.slice(0, 20)}...</div>
                        </div>
                      )}
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary" disabled={registerMutation.isPending} style={{ fontFamily: 'var(--font-mono)', alignSelf: 'flex-start' }}>
                    {registerMutation.isPending ? 'Registering…' : 'Register agent on-chain'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', border: '1px solid var(--border-dim)', flexWrap: 'wrap' }}>
        {['ALL', 'ACTIVE', 'PENDING', 'CODE', 'NLP', 'DATA', 'VISION'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
            style={{ border: 'none', borderRight: '1px solid var(--border-dim)', fontFamily: 'var(--font-mono)' }}>
            {f === 'ALL' ? 'All builders' : f.toLowerCase()}
          </button>
        ))}
      </div>

      {/* Agent Grid */}
      {agentsQuery.isPending ? (
        <AsyncState kind="loading" title="Loading agent registry" />
      ) : agentsQuery.isError ? (
        <AsyncState kind="error" title="Agent registry unavailable" message={agentsQuery.error.message} onRetry={agentsQuery.refetch} />
      ) : filtered.length === 0 ? (
        <AsyncState kind="empty" title="No agents match these filters" action={address && !myAgent ? <button className="btn btn-primary btn-sm" onClick={() => setView('register')}>Register an agent</button> : null} />
      ) : (
        <div className="agent-grid">
          {filtered.map((agent) => (
            <div className="agent-card" key={agent.agentId} style={{ borderColor: agent.agentId === myAgent?.agentId ? 'var(--accent-success)' : undefined }}>
              <div className="agent-header">
                <div className="agent-id">{agent.agentId}</div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span className="badge">{agent.category}</span>
                  <span className="badge" style={{ color: statusColor(agent.status) }}>{agent.status}</span>
                </div>
              </div>
              <div className="agent-stats">
                <div className="agent-stat">
                  <span className="agent-stat-label">Reputation</span>
                  <span className="agent-stat-value" style={{ color: (agent.reputationScore ?? 0) >= 7000 ? 'var(--text-pure)' : 'var(--text-dim)' }}>{agent.reputationPercent}</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-label">Completed</span>
                  <span className="agent-stat-value">{agent.tasksCompleted}</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-label">Streak</span>
                  <span className="agent-stat-value">{agent.currentStreak}</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-label">Quality</span>
                  <span className="agent-stat-value">{agent.avgQualityScore || 'Not rated'}</span>
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '8px' }}>
                {`${agent.walletAddress?.slice(0, 8)}...${agent.walletAddress?.slice(-6)}`}
                {agent.isVerified && <span style={{ color: 'var(--accent-success)', marginLeft: '8px' }}>Verified</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
