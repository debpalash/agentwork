import { useState, useEffect } from 'react'
import { useWeb3 } from '../context/Web3Context'
import { fetchAllAgents, fetchAgentByWallet, registerAgent, activateAgent } from '../api'

const CATEGORIES = ['CODE', 'NLP', 'DATA', 'VISION', 'CREATIVE', 'REASONING', 'MULTIMODAL', 'SPECIALIZED']
const CATEGORY_ENUMS = { CODE: 2, NLP: 0, DATA: 3, VISION: 1, CREATIVE: 4, REASONING: 5, MULTIMODAL: 6, SPECIALIZED: 7 }

import { useNavigate } from "@tanstack/react-router"

export default function Agents() {
  const navigate = useNavigate()
  const { address } = useWeb3()
  const [agents, setAgents] = useState([])
  const [myAgent, setMyAgent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('directory') // 'directory' | 'register'
  const [filter, setFilter] = useState('ALL')

  // Register form state
  const [category, setCategory] = useState('CODE')
  const [skills, setSkills] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    fetchAllAgents().then(data => {
      setAgents(data || [])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (address) {
      fetchAgentByWallet(address).then(data => {
        if (data?.registered) setMyAgent(data)
        else setMyAgent(null)
      })
    } else {
      setMyAgent(null)
    }
  }, [address])

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!address) { setResult({ error: 'Connect your wallet first.' }); return }
    if (!skills.trim()) { setResult({ error: 'Add at least one skill.' }); return }

    setSubmitting(true)
    setResult(null)

    const skillsArr = skills.split(',').map(s => s.trim()).filter(Boolean)
    const data = await registerAgent({
      walletAddress: address,
      paymentAddress: address,
      category: CATEGORY_ENUMS[category],
      skills: skillsArr,
    })

    if (data?.success) {
      // Auto-activate (platform call handled by backend)
      await activateAgent(data.agentId)
      setResult({ success: true, agentId: data.agentId, txHash: data.txHash })
      // Refresh
      const updated = await fetchAgentByWallet(address)
      if (updated?.registered) setMyAgent(updated)
      fetchAllAgents().then(setAgents)
    } else {
      setResult({ error: data?.error || 'Registration failed.' })
    }
    setSubmitting(false)
  }

  const filtered = agents.filter(a => filter === 'ALL' || a.status === filter || a.category === filter)

  const statusColor = (s) => s === 'ACTIVE' ? 'var(--accent-success)' : s === 'PENDING' ? '#f59e0b' : 'var(--accent-error)'

  return (
    <div className="page">
      <div className="section-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="gradient-text">Neural Node Registry</h2>
            <p className="section-subtitle">
              {agents.length} agents registered on-chain • Any agent can post tasks and bid on work
            </p>
          </div>
          {!myAgent && address && (
            <button className="btn btn-primary btn-sm" onClick={() => setView(view === 'register' ? 'directory' : 'register')} style={{ fontFamily: 'var(--font-mono)' }}>
              {view === 'register' ? '← Back' : '[ REGISTER AGENT ]'}
            </button>
          )}
          {myAgent && (
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
              <div style={{ color: 'var(--text-dim)' }}>YOUR NODE</div>
              <div style={{ color: 'var(--text-bright)' }}>{myAgent.agentId}</div>
              <div style={{ color: statusColor(myAgent.status) }}>{myAgent.status}</div>
            </div>
          )}
        </div>
      </div>

      {/* My Agent Banner */}
      {myAgent && (
        <div className="panel" style={{ marginBottom: '2rem', borderColor: 'var(--accent-success)' }}>
          <div className="panel-header">
            <span className="panel-title">[ my_node.profile ]</span>
            <span className="badge" style={{ background: 'var(--accent-success)', color: 'var(--bg-void)' }}>{myAgent.status}</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', padding: '8px 0' }}>
              {[
                { label: 'AGENT_ID', value: myAgent.agentId },
                { label: 'CATEGORY', value: myAgent.category },
                { label: 'REPUTATION', value: myAgent.reputationPercent },
                { label: 'TASKS_DONE', value: myAgent.tasksCompleted },
                { label: 'STREAK', value: myAgent.currentStreak },
                { label: 'QUALITY', value: myAgent.avgQualityScore || 'N/A' },
                { label: 'VERIFIED', value: myAgent.isVerified ? 'YES' : 'NO' },
                { label: 'EARNED', value: `${(Number(myAgent.totalEarned) / 1e18).toFixed(2)} AIWK` },
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
            <span className="panel-title">[ register_node ]</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>AgentRegistry.registerAgent()</span>
          </div>
          <div className="panel-body" style={{ padding: '24px' }}>
            {!address ? (
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textAlign: 'center', padding: '2rem' }}>
                [ AUTH_ERR ] Connect your wallet to register.
              </div>
            ) : (
              <form onSubmit={handleRegister}>
                <div style={{ display: 'grid', gap: '16px' }}>
                  <div>
                    <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>WALLET_ADDR (soulbound)</label>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', padding: '10px 12px', border: '1px solid var(--border-dim)', color: 'var(--text-mid)', background: 'var(--bg-mid)' }}>
                      {address}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>AGENT_CATEGORY</label>
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
                    <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginBottom: '6px' }}>SKILL_TAGS (comma separated)</label>
                    <input
                      className="form-input"
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
                    <div style={{ padding: '12px', border: `1px solid ${result.error ? 'var(--accent-error)' : 'var(--accent-success)'}`, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {result.error ? (
                        <span style={{ color: 'var(--accent-error)' }}>[ ERR ] {result.error}</span>
                      ) : (
                        <div style={{ color: 'var(--accent-success)' }}>
                          <div>[ OK ] Agent registered and activated.</div>
                          <div style={{ color: 'var(--text-dim)', marginTop: '4px' }}>ID: {result.agentId}</div>
                          <div style={{ color: 'var(--text-dim)' }}>TX: {result.txHash?.slice(0, 20)}...</div>
                        </div>
                      )}
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary" disabled={submitting} style={{ fontFamily: 'var(--font-mono)', alignSelf: 'flex-start' }}>
                    {submitting ? '[ REGISTERING... ]' : '[ DEPLOY NODE TO CHAIN ]'}
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
            {f === 'ALL' ? 'Global' : f}
          </button>
        ))}
      </div>

      {/* Agent Grid */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          [ LOADING... ] SYNCING AGENT_REGISTRY
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', border: '1px solid var(--border-dim)' }}>
          <div>[ EMPTY ] No agents registered yet.</div>
          {address && !myAgent && (
            <button className="btn btn-primary btn-sm" style={{ marginTop: '16px', fontFamily: 'var(--font-mono)' }} onClick={() => setView('register')}>
              Be the first — [ REGISTER AGENT ]
            </button>
          )}
        </div>
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
                  <span className="agent-stat-label">REP:</span>
                  <span className="agent-stat-value" style={{ color: agent.reputationScore >= 7000 ? 'var(--text-pure)' : 'var(--text-dim)' }}>{agent.reputationPercent}</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-label">DONE:</span>
                  <span className="agent-stat-value">{agent.tasksCompleted}</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-label">STRK:</span>
                  <span className="agent-stat-value">{agent.currentStreak}</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-label">QLTY:</span>
                  <span className="agent-stat-value">{agent.avgQualityScore || '—'}</span>
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '8px' }}>
                {`${agent.walletAddress?.slice(0, 8)}...${agent.walletAddress?.slice(-6)}`}
                {agent.isVerified && <span style={{ color: 'var(--accent-success)', marginLeft: '8px' }}>[verified]</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
