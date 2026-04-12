import React, { useState, useEffect } from 'react'
import { useWeb3 } from '../context/Web3Context'
import { fetchAgentByWallet } from '../api'

import { useNavigate } from "@tanstack/react-router"

export default function Profile() {
  const navigate = useNavigate()
  const { address, networkOk, targetChain, disconnectWallet } = useWeb3()
  const [agent, setAgent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (address) {
      setLoading(true)
      fetchAgentByWallet(address).then(data => {
        setAgent(data?.registered ? data : null)
        setLoading(false)
      })
    }
  }, [address])

  const copy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!address) {
    return (
      <div className="page">
        <div className="section-header">
          <h2 className="gradient-text">Node Profile</h2>
        </div>
        <div className="panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          [ AUTH_ERR ] No wallet connected. Click [ CONNECT NODE ] in the navbar.
        </div>
      </div>
    )
  }

  const statusColor = (s) => s === 'ACTIVE' ? 'var(--accent-success)' : s === 'PENDING' ? '#f59e0b' : 'var(--accent-error)'

  return (
    <div className="page">
      <div className="section-header">
        <h2 className="gradient-text">Node Profile</h2>
        <p className="section-subtitle">On-chain identity, reputation, and environment configuration</p>
      </div>

      {/* Wallet Info */}
      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <span className="panel-title">[ wallet.connection ]</span>
          <span className="badge" style={{ background: networkOk ? 'var(--accent-success)' : 'var(--accent-error)', color: 'var(--bg-void)' }}>
            {networkOk ? 'ONLINE' : 'WRONG_NET'}
          </span>
        </div>
        <div className="panel-body">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
            <tbody>
              {[
                { label: 'WALLET_ADDR', value: address },
                { label: 'CHAIN_ID', value: targetChain?.id },
                { label: 'CHAIN_NAME', value: targetChain?.name },
                { label: 'RPC_ENDPOINT', value: targetChain?.rpcUrls?.default?.http?.[0] },
              ].map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                  <td style={{ padding: '10px 16px', color: 'var(--text-dim)', width: '180px' }}>{r.label}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-bright)', wordBreak: 'break-all' }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Profile */}
      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <span className="panel-title">[ agent.profile ]</span>
          {loading && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>LOADING...</span>}
          {!loading && agent && <span className="badge" style={{ color: statusColor(agent.status) }}>{agent.status}</span>}
          {!loading && !agent && <span className="badge" style={{ color: 'var(--accent-error)' }}>UNREGISTERED</span>}
        </div>
        <div className="panel-body">
          {!loading && !agent ? (
            <div style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                No agent registered for this wallet. Register to post tasks and bid on work.
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate({ to: '/agents' })} style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                [ REGISTER AGENT ]
              </button>
            </div>
          ) : agent ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '20px', padding: '16px' }}>
                {[
                  { label: 'AGENT_ID', value: agent.agentId },
                  { label: 'CATEGORY', value: agent.category },
                  { label: 'REPUTATION', value: agent.reputationPercent },
                  { label: 'TASKS_DONE', value: agent.tasksCompleted },
                  { label: 'TASKS_FAILED', value: agent.tasksFailed },
                  { label: 'CUR_STREAK', value: agent.currentStreak },
                  { label: 'BEST_STREAK', value: agent.bestStreak },
                  { label: 'AVG_QUALITY', value: agent.avgQualityScore || '—' },
                  { label: 'VERIFIED', value: agent.isVerified ? '✓ YES' : '✗ NO' },
                  { label: 'TOTAL_EARNED', value: `${(Number(agent.totalEarned) / 1e18).toFixed(4)} AIWK` },
                  { label: 'STAKED', value: `${(Number(agent.stakedAmount) / 1e18).toFixed(2)} AIWK` },
                  { label: 'REGISTERED', value: agent.registrationTime ? new Date(agent.registrationTime * 1000).toLocaleDateString() : '—' },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{s.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-bright)', marginTop: '4px' }}>{String(s.value)}</div>
                  </div>
                ))}
              </div>
              {/* Rep bar */}
              <div style={{ padding: '0 16px 16px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: '6px' }}>REPUTATION_SCORE ({agent.reputationScore}/10000)</div>
                <div style={{ height: '4px', background: 'var(--border-dim)' }}>
                  <div style={{ height: '100%', width: `${agent.reputationScore / 100}%`, background: agent.reputationScore >= 7000 ? 'var(--accent-success)' : 'var(--text-pure)' }} />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Contract Addresses */}
      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header"><span className="panel-title">[ contracts.deployed ]</span></div>
        <div className="panel-body">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
            <tbody>
              {[
                { label: 'TOKEN', addr: '0x5FbDB2315678afecb367f032d93F642f64180aa3' },
                { label: 'AGENT_REGISTRY', addr: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' },
                { label: 'ESCROW_VAULT', addr: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' },
                { label: 'COMPLEXITY_ORACLE', addr: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' },
                { label: 'TASK_MANAGER', addr: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' },
              ].map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-dim)', cursor: 'pointer' }} onClick={() => copy(c.addr)}>
                  <td style={{ padding: '10px 16px', color: 'var(--text-dim)', width: '180px' }}>{c.label}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-bright)' }}>{c.addr}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--text-dim)', fontSize: '0.7rem' }}>[cpy]</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => copy(address)} style={{ fontFamily: 'var(--font-mono)' }}>
          {copied ? '[✓] Copied!' : '[CPY] Copy Address'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => window.open('http://git.aiwork.network', '_blank')} style={{ fontFamily: 'var(--font-mono)' }}>
          [GIT] Forgejo
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => window.open('http://localhost:8085', '_blank')} style={{ fontFamily: 'var(--font-mono)' }}>
          [OBS] SigNoz
        </button>
        <button className="btn btn-secondary btn-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-error)', borderColor: 'var(--accent-error)' }}
          onClick={() => { disconnectWallet(); navigate({ to: '/dashboard' }) }}>
          [END] Disconnect
        </button>
      </div>
    </div>
  )
}
