import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useWeb3 } from '../context/Web3Context'
import { fetchAgentByWallet } from '../api'
import AsyncState from '../components/AsyncState'
import Icon from '../components/Icon'

export default function Profile() {
  const navigate = useNavigate()
  const { address, networkOk, targetChain, disconnectWallet } = useWeb3()
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentQuery = useQuery({
    queryKey: ['agent-by-wallet', address],
    queryFn: () => fetchAgentByWallet(address as string),
    enabled: Boolean(address),
  })
  const agent = agentQuery.data?.registered ? agentQuery.data : null

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const contracts = [
    { label: 'Payment token', address: import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS || (import.meta.env.DEV ? '0x5FbDB2315678afecb367f032d93F642f64180aa3' : '') },
    { label: 'Agent registry', address: import.meta.env.VITE_AGENT_REGISTRY_ADDRESS || (import.meta.env.DEV ? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' : '') },
    { label: 'Escrow vault', address: import.meta.env.VITE_ESCROW_VAULT_ADDRESS || (import.meta.env.DEV ? '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' : '') },
    { label: 'Dispute resolution', address: import.meta.env.VITE_DISPUTE_RESOLUTION_ADDRESS || '' },
    { label: 'Task manager', address: import.meta.env.VITE_TASK_MANAGER_ADDRESS || (import.meta.env.DEV ? '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' : '') },
  ].filter(contract => contract.address)

  if (!address) {
    return (
      <div className="page page-narrow">
        <header className="section-header section-header-left">
          <span className="eyebrow">Identity</span>
          <h1>Wallet and builder profile</h1>
        </header>
        <AsyncState kind="empty" title="Connect a wallet" message="Connect a wallet from the navigation to inspect its builder identity and network configuration." />
      </div>
    )
  }

  const statusColor = (status: string) => status === 'ACTIVE' ? 'var(--accent-success)' : status === 'PENDING' ? 'var(--accent-warn)' : 'var(--accent-error)'
  const profileStats = agent ? [
    { label: 'Builder ID', value: agent.agentId },
    { label: 'Category', value: agent.category },
    { label: 'Reputation', value: agent.reputationPercent },
    { label: 'Tasks completed', value: agent.tasksCompleted },
    { label: 'Tasks failed', value: agent.tasksFailed },
    { label: 'Current streak', value: agent.currentStreak },
    { label: 'Best streak', value: agent.bestStreak },
    { label: 'Average quality', value: agent.avgQualityScore || 'Not rated' },
    { label: 'Verified', value: agent.isVerified ? 'Yes' : 'No' },
    { label: 'Total earned', value: `${(Number(agent.totalEarned) / 1e18).toFixed(4)} AIWK` },
    { label: 'Staked', value: `${(Number(agent.stakedAmount) / 1e18).toFixed(2)} AIWK` },
    { label: 'Registered', value: agent.registrationTime ? new Date(agent.registrationTime * 1000).toLocaleDateString() : 'Not available' },
  ] : []

  return (
    <div className="page page-narrow">
      <header className="section-header section-header-left">
        <span className="eyebrow">Identity</span>
        <h1>Wallet and builder profile</h1>
        <p className="section-subtitle">On-chain identity, reputation, and network configuration.</p>
      </header>

      <section className="panel profile-panel" aria-labelledby="wallet-title">
        <div className="panel-header">
          <h2 className="panel-title" id="wallet-title">Wallet connection</h2>
          <span className="badge" style={{ color: networkOk ? 'var(--accent-success)' : 'var(--accent-error)' }}>
            {networkOk ? 'Connected' : 'Wrong network'}
          </span>
        </div>
        <dl className="profile-facts">
          {[
            { label: 'Wallet address', value: address },
            { label: 'Chain ID', value: targetChain?.id },
            { label: 'Network', value: targetChain?.name },
            { label: 'RPC endpoint', value: targetChain?.rpcUrls?.default?.http?.[0] },
          ].map(row => <div key={row.label}><dt>{row.label}</dt><dd className="mono-value">{row.value || 'Not available'}</dd></div>)}
        </dl>
      </section>

      <section className="panel profile-panel" aria-labelledby="builder-title">
        <div className="panel-header">
          <h2 className="panel-title" id="builder-title">Builder profile</h2>
          {agentQuery.isPending && <span className="panel-count">Loading</span>}
          {agentQuery.isSuccess && agent && <span className="badge" style={{ color: statusColor(agent.status) }}>{agent.status.toLowerCase()}</span>}
          {agentQuery.isSuccess && !agent && <span className="badge">Not registered</span>}
        </div>
        <div className="panel-body">
          {agentQuery.isError ? (
            <AsyncState kind="error" title="Builder profile unavailable" message={agentQuery.error.message} onRetry={agentQuery.refetch} />
          ) : agentQuery.isSuccess && !agent ? (
            <div className="profile-registration">
              <p>No builder is registered for this wallet. Registration is required to bid and execute, but not to fund or post work.</p>
              <button className="btn btn-primary btn-sm" onClick={() => navigate({ to: '/agents' })}>Register a builder</button>
            </div>
          ) : agent ? (
            <>
              <dl className="profile-stat-grid">
                {profileStats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{String(stat.value)}</dd></div>)}
              </dl>
              <div className="reputation-meter">
                <div className="content-label-row"><span>Reputation score</span><span>{agent.reputationScore}/10000</span></div>
                <div className="reputation-track"><span style={{ width: `${(agent.reputationScore ?? 0) / 100}%` }} /></div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel profile-panel" aria-labelledby="contracts-title">
        <div className="panel-header"><h2 className="panel-title" id="contracts-title">Deployed contracts</h2></div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Contract</th><th>Address</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {contracts.map(contract => (
                <tr key={contract.label}>
                  <td>{contract.label}</td>
                  <td className="mono-value">{contract.address}</td>
                  <td><button className="btn btn-ghost btn-sm" type="button" aria-label={`Copy ${contract.label} address`} onClick={() => copy(contract.address)}><Icon name="copy" size={17} /> Copy</button></td>
                </tr>
              ))}
              {!contracts.length && <tr><td colSpan={3}><AsyncState kind="empty" title="No contract addresses configured" /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="profile-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => copy(address)}><Icon name="copy" size={17} />{copied ? 'Copied' : 'Copy address'}</button>
        <button className="btn btn-secondary btn-sm" onClick={() => window.open(import.meta.env.VITE_FORGEJO_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '/docs'), '_blank', 'noopener,noreferrer')}><Icon name="repository" size={17} />Git workspace</button>
        {(import.meta.env.VITE_SIGNOZ_URL || import.meta.env.DEV) && <button className="btn btn-secondary btn-sm" onClick={() => window.open(import.meta.env.VITE_SIGNOZ_URL || 'http://localhost:8085', '_blank', 'noopener,noreferrer')}><Icon name="activity" size={17} />Observability</button>}
        <span className="sr-only" role="status" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
        <button className="btn btn-danger btn-sm" onClick={() => { disconnectWallet(); navigate({ to: '/dashboard' }) }}><Icon name="disconnect" size={17} />Disconnect wallet</button>
      </div>
    </div>
  )
}
