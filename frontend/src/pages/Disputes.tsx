import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { keccak256, parseAbi, toHex, type Address, type Hex } from 'viem'
import { useState, type FormEvent } from 'react'
import { useWeb3 } from '../context/Web3Context'
import { projectDispute, syncDispute } from '../api'
import AsyncState from '../components/AsyncState'
import Icon from '../components/Icon'
import type { DisputeRecord } from '../types'

const API = '/api/v1'
const TASK_MANAGER = import.meta.env.VITE_TASK_MANAGER_ADDRESS
const DISPUTE_RESOLUTION = import.meta.env.VITE_DISPUTE_RESOLUTION_ADDRESS
// Dispute bonds are denominated by DisputeResolution and may differ from the
// stablecoin used to fund a task. Keep a payment-token fallback for local
// deployments created before the dedicated variable existed.
const TOKEN = import.meta.env.VITE_BOND_TOKEN_ADDRESS || import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS
const TASK_ABI = parseAbi(['function openDispute(bytes32,bytes32) returns (uint256)'])
const DISPUTE_ABI = parseAbi([
  'function disputeBond() view returns (uint256)',
  'function vote(uint256,uint8)',
])
const TOKEN_ABI = parseAbi([
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
])
type DisputeVote = 'FAVOR_WORKER' | 'FAVOR_POSTER' | 'SPLIT'
type OpenDisputeInput = { taskId: string; reason: string }
type VoteInput = { disputeId: string; chainDisputeId: string; vote: DisputeVote }
const voteDecisions: Record<DisputeVote, 1 | 2 | 3> = { FAVOR_WORKER: 1, FAVOR_POSTER: 2, SPLIT: 3 }

export default function Disputes() {
  const { address, walletClient, publicClient, networkOk } = useWeb3()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ taskId: '', reason: '' })

  // Fetch all disputes (we query by a dummy task or use a list-all approach)
  const { data: disputes, isLoading, isError, error, refetch } = useQuery<DisputeRecord[]>({
    queryKey: ['disputes'],
    queryFn: async () => {
      const res = await fetch(`${API}/disputes/task/all`)
      const data = await res.json() as { disputes?: DisputeRecord[]; error?: string }
      if (!res.ok) throw new Error(data.error || `Disputes request failed with HTTP ${res.status}`)
      return data.disputes || []
    },
    refetchInterval: 10000,
  })

  const openMutation = useMutation<DisputeRecord, Error, OpenDisputeInput>({
    mutationFn: async ({ taskId, reason }) => {
      if (!address || !walletClient || !publicClient) throw new Error('Connect the task-party wallet')
      if (!networkOk) throw new Error('Switch to the configured network')
      if (!TASK_MANAGER || !DISPUTE_RESOLUTION || !TOKEN) throw new Error('Dispute contracts are not configured')
      const bond = await publicClient.readContract({
        address: DISPUTE_RESOLUTION as Address,
        abi: DISPUTE_ABI,
        functionName: 'disputeBond',
      })
      const allowance = await publicClient.readContract({
        address: TOKEN as Address,
        abi: TOKEN_ABI,
        functionName: 'allowance',
        args: [address, DISPUTE_RESOLUTION as Address],
      })
      if (allowance < bond) {
        const approvalHash = await walletClient.writeContract({
          account: address,
          chain: undefined,
          address: TOKEN as Address,
          abi: TOKEN_ABI,
          functionName: 'approve',
          args: [DISPUTE_RESOLUTION as Address, bond],
        })
        await publicClient.waitForTransactionReceipt({ hash: approvalHash })
      }
      const openTxHash = await walletClient.writeContract({
        account: address,
        chain: undefined,
        address: TASK_MANAGER as Address,
        abi: TASK_ABI,
        functionName: 'openDispute',
        args: [taskId as Hex, keccak256(toHex(reason))],
      })
      await publicClient.waitForTransactionReceipt({ hash: openTxHash })
      const projected = await projectDispute(
        { taskId, reason, openTxHash },
        { address, walletClient }
      )
      return projected
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disputes'] })
      setShowForm(false)
      setForm({ taskId: '', reason: '' })
    },
  })

  const voteMutation = useMutation<DisputeRecord, Error, VoteInput>({
    mutationFn: async ({ disputeId, chainDisputeId, vote }) => {
      if (!address || !walletClient || !publicClient) throw new Error('Connect the assigned arbiter wallet')
      if (!networkOk) throw new Error('Switch to the configured network')
      if (!DISPUTE_RESOLUTION) throw new Error('Dispute contract is not configured')
      const decision = voteDecisions[vote]
      const txHash = await walletClient.writeContract({
        account: address,
        chain: undefined,
        address: DISPUTE_RESOLUTION as Address,
        abi: DISPUTE_ABI,
        functionName: 'vote',
        args: [BigInt(chainDisputeId), decision],
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      const projected = await syncDispute(disputeId, txHash)
      return projected
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] }),
  })

  function handleOpen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    openMutation.mutate({
      taskId: form.taskId,
      reason: form.reason,
    })
  }

  function handleVote(disputeId: string, chainDisputeId: string, vote: DisputeVote) {
    voteMutation.mutate({
      disputeId,
      chainDisputeId,
      vote,
    })
  }

  const statusColor = (s: string) => {
    if (s === 'RESOLVED') return 'var(--accent-success)'
    if (s === 'VOTING') return 'var(--accent-warn)'
    if (s === 'CANCELLED') return 'var(--text-dim)'
    return 'var(--accent-muted-cyan)'
  }

  const resolutionLabel = (r?: string) => {
    if (r === 'FAVOR_WORKER') return 'Builder wins'
    if (r === 'FAVOR_POSTER') return 'Funder wins'
    if (r === 'SPLIT') return 'Split settlement'
    return 'Not resolved'
  }

  return (
    <div className="page page-narrow">
      <div className="section-header section-header-left section-header-action">
        <div>
          <span className="eyebrow">Settlement safeguard</span>
          <h1>Disputes and arbitration</h1>
          <p className="section-subtitle">Bonded three-arbiter panels record a majority decision on-chain.</p>
        </div>
        <button
          className={`btn ${showForm ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : 'Open a dispute'}
        </button>
      </div>

      {/* Open Dispute Form */}
      {showForm && (
        <form onSubmit={handleOpen} className="panel dispute-form">
          <h2>Open a new dispute</h2>

          <div>
            <label htmlFor="dispute-task-id" style={{ display: 'block', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginBottom: '4px' }}>
              Task ID (bytes32)
            </label>
            <input
              id="dispute-task-id"
              name="taskId"
              type="text"
              value={form.taskId}
              onChange={(e) => setForm({ ...form, taskId: e.target.value })}
              placeholder="0xabc123..."
              required
              style={{
                width: '100%',
                background: 'var(--bg-void)',
                border: '1px solid var(--border-dim)',
                color: 'var(--text-bright)',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
              }}
            />
          </div>

          <div>
            <label htmlFor="dispute-reason" style={{ display: 'block', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginBottom: '4px' }}>
              Reason
            </label>
            <textarea
              id="dispute-reason"
              name="reason"
              minLength={20}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Describe the dispute..."
              required
              rows={3}
              style={{
                width: '100%',
                background: 'var(--bg-void)',
                border: '1px solid var(--border-dim)',
                color: 'var(--text-bright)',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
            A bonded panel is selected after your opening transaction finalizes. Neither task party chooses the arbiters.
          </div>

          <button type="submit" className="btn btn-danger" disabled={openMutation.isPending}>
            {openMutation.isPending ? 'Opening dispute' : 'Submit dispute'}
          </button>

          {openMutation.isError && (
            <div role="alert" style={{ color: 'var(--accent-error)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              Error: {openMutation.error?.message}
            </div>
          )}
          {openMutation.isSuccess && (
            <div role="status" style={{ color: 'var(--accent-success)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
              Dispute opened. Arbiters notified.
            </div>
          )}
        </form>
      )}

      {/* Dispute List */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {isLoading ? (
          <AsyncState kind="loading" title="Loading disputes" />
        ) : isError ? (
          <AsyncState kind="error" title="Dispute registry unavailable" message={error.message} onRetry={refetch} />
        ) : !disputes?.length ? (
          <div className="panel dispute-empty">
            <Icon name="disputes" size={30} />
            <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No active disputes</div>
            <div style={{ fontSize: '0.8rem' }}>Open a dispute to contest a task verification or payment.</div>
          </div>
        ) : (
          disputes.map((d) => (
            <article
              key={d.id}
              className="panel dispute-card"
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
                  {d.created_at ? new Date(d.created_at).toLocaleDateString() : 'Date unavailable'}
                </span>
              </div>

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                Task: {d.task_id?.slice(0, 18)}...
              </div>

              <div style={{ color: 'var(--text-bright)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                {d.reason}
              </div>

              {/* Arbiters */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {(d.arbiters || []).map((a, i) => (
                  <span key={i} style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.7rem',
                    color: 'var(--accent-violet)',
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
                    Votes ({d.votes.length}/3)
                  </div>
                  {d.votes.map((v, i) => (
                    <div key={i} style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      color: v.vote === 'FAVOR_WORKER' ? 'var(--accent-success)' : v.vote === 'FAVOR_POSTER' ? 'var(--accent-warn)' : 'var(--accent-muted-cyan)',
                      padding: '2px 0',
                    }}>
                      {v.arbiter?.slice(0, 10)}...: {resolutionLabel(v.vote)}
                    </div>
                  ))}
                </div>
              )}

              {/* Resolution */}
              {d.status === 'RESOLVED' && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.9rem',
                  color: 'var(--accent-success)',
                  padding: '8px 12px',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                }}>
                  Resolution: {resolutionLabel(d.resolution)}
                </div>
              )}

              {/* Vote Buttons */}
              {d.status === 'VOTING' && address && (d.arbiters || []).some((arbiter) => arbiter.toLowerCase() === address.toLowerCase()) && (
                <div className="dispute-vote-actions">
                  {['FAVOR_WORKER', 'FAVOR_POSTER', 'SPLIT'].map((v) => (
                    <button
                      key={v}
                      onClick={() => handleVote(d.id, d.chain_dispute_id || d.chainDisputeId || '0', v as DisputeVote)}
                      disabled={voteMutation.isPending}
                      className="btn btn-secondary btn-sm"
                    >
                      {v === 'FAVOR_WORKER' ? 'Builder' : v === 'FAVOR_POSTER' ? 'Funder' : 'Split'}
                    </button>
                  ))}
                </div>
              )}
              {voteMutation.isError && (
                <div role="alert" style={{ color: 'var(--accent-error)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginTop: '0.75rem' }}>
                  Error: {voteMutation.error?.message}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  )
}
