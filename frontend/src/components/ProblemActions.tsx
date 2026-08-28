import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { Address, WalletClient } from 'viem'
import {
  createContributionEvidence,
  createContributionReview,
  createProblemContribution,
  createProblemFunding,
  createProblemWorkstream,
} from '../api'
import type { ApiRecord, FundingMechanism, MutationResult, Problem, ProblemGraphData } from '../types'

const artifactTypes = ['ANALYSIS', 'CODE', 'PROOF', 'DATASET', 'MODEL', 'PAPER', 'PROTOCOL', 'EXPERIMENT', 'REVIEW', 'NEGATIVE_RESULT', 'OTHER']
const evidenceTypes = ['SUPPORTS', 'REFUTES', 'REPLICATES', 'REVIEWS', 'BENCHMARKS']
const fundingMechanisms = ['GRANT', 'MILESTONE', 'PRIZE', 'REPLICATION_BOUNTY', 'RETROACTIVE'] as const

interface MutationState {
  isError: boolean
  isSuccess: boolean
  isPending: boolean
  error: Error | null
}

type FundingInput = { mechanism: FundingMechanism; token: string; committedAmount: string; escrowReference?: string }
type ContributionAction = { contributionId: string; input: ApiRecord }

interface ProblemActionsProps {
  problem: Problem
  graph: ProblemGraphData
  address: Address | null
  walletClient: WalletClient | null
  connectWallet: () => Promise<void>
  onChanged: () => Promise<unknown>
}

function MutationFeedback({ mutation, success }: { mutation: MutationState; success: string }) {
  if (mutation.isError) return <p className="action-feedback error" role="alert">{mutation.error?.message || 'Request failed'}</p>
  if (mutation.isSuccess) return <p className="action-feedback success" role="status">{success}</p>
  return null
}

function SubmitButton({ mutation, connected, children }: { mutation: MutationState; connected: boolean; children: ReactNode }) {
  return (
    <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
      {mutation.isPending ? 'Signing request…' : connected ? children : 'Connect wallet to continue'}
    </button>
  )
}

export default function ProblemActions({ problem, graph, address, walletClient, connectWallet, onChanged }: ProblemActionsProps) {
  const connected = Boolean(address && walletClient)
  const auth = { address, walletClient }
  const prefix = `problem-${problem.id}`
  const [funding, setFunding] = useState<FundingInput & { escrowReference: string }>({ mechanism: 'GRANT', token: 'USDC', committedAmount: '', escrowReference: '' })
  const [workstream, setWorkstream] = useState({ title: '', description: '' })
  const [contribution, setContribution] = useState({ workstreamId: '', title: '', summary: '', artifactUri: '', artifactDigest: '', artifactType: 'ANALYSIS', license: 'CC-BY-4.0' })
  const [evidence, setEvidence] = useState({ contributionId: '', evidenceType: 'SUPPORTS', uri: '', digest: '', confidence: '0.8', methodology: '' })
  const [review, setReview] = useState({ contributionId: '', verdict: 'ACCEPT', score: '80', rationale: '', hasConflict: false, conflictDetails: '' })

  const afterWrite = async () => { await onChanged() }
  const fundingMutation = useMutation<MutationResult, Error, FundingInput>({ mutationFn: input => createProblemFunding(problem.id, input, auth), onSuccess: afterWrite })
  const workstreamMutation = useMutation<MutationResult, Error, ApiRecord>({ mutationFn: input => createProblemWorkstream(problem.id, input, auth), onSuccess: afterWrite })
  const contributionMutation = useMutation<MutationResult, Error, ApiRecord>({ mutationFn: input => createProblemContribution(problem.id, input, auth), onSuccess: afterWrite })
  const evidenceMutation = useMutation<MutationResult, Error, ContributionAction>({ mutationFn: ({ contributionId, input }) => createContributionEvidence(contributionId, input, auth), onSuccess: afterWrite })
  const reviewMutation = useMutation<MutationResult, Error, ContributionAction>({ mutationFn: ({ contributionId, input }) => createContributionReview(contributionId, input, auth), onSuccess: afterWrite })

  const requireWallet = async () => {
    if (connected) return true
    await connectWallet()
    return false
  }
  const provenance = () => ({
    generatedAt: new Date().toISOString(),
    generatedBy: [{ id: address?.toLowerCase() || 'wallet-not-connected', type: 'HUMAN', role: 'CONTRIBUTOR' }],
    inputs: [],
    environment: { application: 'Collagent web', chainId: Number(import.meta.env.VITE_CHAIN_ID || 31337) },
  })

  return (
    <section className="problem-actions" aria-labelledby={`${prefix}-participate`}>
      <div className="problem-actions-heading">
        <div>
          <span className="protocol-label">PARTICIPATE</span>
          <h3 id={`${prefix}-participate`}>Choose your role in this problem</h3>
        </div>
        <p>Wallet signatures identify the human taking each action. Autonomous agents should use a scoped API key through the SDK or MCP server.</p>
      </div>

      <div className="problem-action-list">
        <details className="problem-action">
          <summary><span>Funder</span> Record a transparent pledge</summary>
          <form onSubmit={async event => {
            event.preventDefault()
            if (!await requireWallet()) return
            fundingMutation.mutate({ ...funding, escrowReference: funding.escrowReference || undefined })
          }}>
            <p className="action-caveat">This records intent only. It does not transfer, lock, or escrow funds.</p>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor={`${prefix}-funding-mechanism`}>Mechanism</label>
                <select id={`${prefix}-funding-mechanism`} name="mechanism" className="input-select" value={funding.mechanism} onChange={event => setFunding(current => ({ ...current, mechanism: event.target.value as FundingMechanism }))}>
                  {fundingMechanisms.map(item => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-funding-amount`}>Amount pledged</label>
                <input id={`${prefix}-funding-amount`} name="committedAmount" className="input-text" inputMode="decimal" pattern="[0-9]+([.][0-9]+)?" required value={funding.committedAmount} onChange={event => setFunding(current => ({ ...current, committedAmount: event.target.value }))} />
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-funding-token`}>Token or currency</label>
                <input id={`${prefix}-funding-token`} name="token" className="input-text" required maxLength={80} value={funding.token} onChange={event => setFunding(current => ({ ...current, token: event.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={`${prefix}-escrow-reference`}>External escrow reference <span>(optional, not verified by Collagent)</span></label>
              <input id={`${prefix}-escrow-reference`} name="escrowReference" className="input-text" value={funding.escrowReference} onChange={event => setFunding(current => ({ ...current, escrowReference: event.target.value }))} />
            </div>
            <SubmitButton mutation={fundingMutation} connected={connected}>Record pledge</SubmitButton>
            <MutationFeedback mutation={fundingMutation} success="Pledge recorded as PLEDGED, not escrowed." />
          </form>
        </details>

        <details className="problem-action">
          <summary><span>Coordinator</span> Add a workstream</summary>
          <form onSubmit={async event => {
            event.preventDefault()
            if (!await requireWallet()) return
            workstreamMutation.mutate({ ...workstream, dependencies: [], budget: {}, acceptancePolicy: {}, metadata: {} })
          }}>
            <div className="form-group">
              <label htmlFor={`${prefix}-workstream-title`}>Workstream title</label>
              <input id={`${prefix}-workstream-title`} name="title" className="input-text" required minLength={5} maxLength={180} value={workstream.title} onChange={event => setWorkstream(current => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor={`${prefix}-workstream-description`}>Scope and expected output</label>
              <textarea id={`${prefix}-workstream-description`} name="description" className="input-text" required minLength={20} rows={4} value={workstream.description} onChange={event => setWorkstream(current => ({ ...current, description: event.target.value }))} />
            </div>
            <SubmitButton mutation={workstreamMutation} connected={connected}>Add workstream</SubmitButton>
            <MutationFeedback mutation={workstreamMutation} success="Workstream added to the public graph." />
          </form>
        </details>

        <details className="problem-action">
          <summary><span>Contributor</span> Register an artifact</summary>
          <form onSubmit={async event => {
            event.preventDefault()
            if (!await requireWallet()) return
            contributionMutation.mutate({
              ...contribution,
              workstreamId: contribution.workstreamId || undefined,
              artifactDigest: contribution.artifactDigest.toLowerCase(),
              provenance: provenance(),
              metadata: {},
            })
          }}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor={`${prefix}-contribution-workstream`}>Workstream <span>(optional)</span></label>
                <select id={`${prefix}-contribution-workstream`} name="workstreamId" className="input-select" value={contribution.workstreamId} onChange={event => setContribution(current => ({ ...current, workstreamId: event.target.value }))}>
                  <option value="">Problem-wide contribution</option>
                  {graph.workstreams.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-artifact-type`}>Artifact type</label>
                <select id={`${prefix}-artifact-type`} name="artifactType" className="input-select" value={contribution.artifactType} onChange={event => setContribution(current => ({ ...current, artifactType: event.target.value }))}>
                  {artifactTypes.map(item => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-artifact-license`}>License</label>
                <input id={`${prefix}-artifact-license`} name="license" className="input-text" required value={contribution.license} onChange={event => setContribution(current => ({ ...current, license: event.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={`${prefix}-contribution-title`}>Contribution title</label>
              <input id={`${prefix}-contribution-title`} name="title" className="input-text" required minLength={5} maxLength={180} value={contribution.title} onChange={event => setContribution(current => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor={`${prefix}-contribution-summary`}>Methods and result summary</label>
              <textarea id={`${prefix}-contribution-summary`} name="summary" className="input-text" required minLength={20} rows={4} value={contribution.summary} onChange={event => setContribution(current => ({ ...current, summary: event.target.value }))} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor={`${prefix}-artifact-uri`}>Public artifact URI</label>
                <input id={`${prefix}-artifact-uri`} name="artifactUri" className="input-text" required value={contribution.artifactUri} onChange={event => setContribution(current => ({ ...current, artifactUri: event.target.value }))} />
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-artifact-digest`}>SHA-256 digest</label>
                <input id={`${prefix}-artifact-digest`} name="artifactDigest" className="input-text code-input" required minLength={64} maxLength={64} pattern="[0-9a-fA-F]{64}" value={contribution.artifactDigest} onChange={event => setContribution(current => ({ ...current, artifactDigest: event.target.value }))} />
              </div>
            </div>
            <SubmitButton mutation={contributionMutation} connected={connected}>Register artifact</SubmitButton>
            <MutationFeedback mutation={contributionMutation} success="Artifact and human provenance registered." />
          </form>
        </details>

        <details className="problem-action">
          <summary><span>Evidence author</span> Attach evidence</summary>
          <form onSubmit={async event => {
            event.preventDefault()
            if (!await requireWallet()) return
            evidenceMutation.mutate({ contributionId: evidence.contributionId, input: {
              subjectContributionId: evidence.contributionId,
              evidenceType: evidence.evidenceType,
              uri: evidence.uri,
              digest: evidence.digest.toLowerCase(),
              confidence: Number(evidence.confidence),
              methodology: { summary: evidence.methodology },
              provenance: provenance(),
            } })
          }}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor={`${prefix}-evidence-contribution`}>Contribution</label>
                <select id={`${prefix}-evidence-contribution`} name="contributionId" className="input-select" required value={evidence.contributionId} onChange={event => setEvidence(current => ({ ...current, contributionId: event.target.value }))}>
                  <option value="">Select an artifact</option>
                  {graph.contributions.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-evidence-type`}>Relationship</label>
                <select id={`${prefix}-evidence-type`} name="evidenceType" className="input-select" value={evidence.evidenceType} onChange={event => setEvidence(current => ({ ...current, evidenceType: event.target.value }))}>
                  {evidenceTypes.map(item => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-confidence`}>Confidence (0 to 1)</label>
                <input id={`${prefix}-confidence`} name="confidence" className="input-text" type="number" min="0" max="1" step="0.01" required value={evidence.confidence} onChange={event => setEvidence(current => ({ ...current, confidence: event.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={`${prefix}-methodology`}>Methodology</label>
              <textarea id={`${prefix}-methodology`} name="methodology" className="input-text" required minLength={20} rows={4} value={evidence.methodology} onChange={event => setEvidence(current => ({ ...current, methodology: event.target.value }))} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor={`${prefix}-evidence-uri`}>Evidence URI</label>
                <input id={`${prefix}-evidence-uri`} name="uri" className="input-text" required value={evidence.uri} onChange={event => setEvidence(current => ({ ...current, uri: event.target.value }))} />
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-evidence-digest`}>SHA-256 digest</label>
                <input id={`${prefix}-evidence-digest`} name="digest" className="input-text code-input" required minLength={64} maxLength={64} pattern="[0-9a-fA-F]{64}" value={evidence.digest} onChange={event => setEvidence(current => ({ ...current, digest: event.target.value }))} />
              </div>
            </div>
            <SubmitButton mutation={evidenceMutation} connected={connected}>Attach evidence</SubmitButton>
            <MutationFeedback mutation={evidenceMutation} success="Evidence attached to the graph." />
          </form>
        </details>

        <details className="problem-action">
          <summary><span>Independent reviewer</span> Submit a verdict</summary>
          <form onSubmit={async event => {
            event.preventDefault()
            if (!await requireWallet()) return
            reviewMutation.mutate({ contributionId: review.contributionId, input: {
              reviewerType: 'HUMAN',
              verdict: review.hasConflict ? 'ABSTAIN' : review.verdict,
              score: Number(review.score),
              rationale: review.rationale,
              conflictDisclosure: { hasConflict: review.hasConflict, details: review.conflictDetails },
              attestation: { interface: 'Collagent web' },
            } })
          }}>
            <p className="action-caveat">Contributors and linked identities cannot review their own artifacts. The server enforces independent identity clusters and assurance thresholds.</p>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor={`${prefix}-review-contribution`}>Contribution</label>
                <select id={`${prefix}-review-contribution`} name="contributionId" className="input-select" required value={review.contributionId} onChange={event => setReview(current => ({ ...current, contributionId: event.target.value }))}>
                  <option value="">Select an artifact</option>
                  {graph.contributions.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-verdict`}>Verdict</label>
                <select id={`${prefix}-verdict`} name="verdict" className="input-select" disabled={review.hasConflict} value={review.hasConflict ? 'ABSTAIN' : review.verdict} onChange={event => setReview(current => ({ ...current, verdict: event.target.value }))}>
                  <option>ACCEPT</option><option>REVISE</option><option>REJECT</option><option>ABSTAIN</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor={`${prefix}-review-score`}>Score (0 to 100)</label>
                <input id={`${prefix}-review-score`} name="score" className="input-text" type="number" min="0" max="100" required value={review.score} onChange={event => setReview(current => ({ ...current, score: event.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor={`${prefix}-rationale`}>Evidence-based rationale</label>
              <textarea id={`${prefix}-rationale`} name="rationale" className="input-text" required minLength={20} rows={4} value={review.rationale} onChange={event => setReview(current => ({ ...current, rationale: event.target.value }))} />
            </div>
            <label className="problem-check" htmlFor={`${prefix}-conflict`}>
              <input id={`${prefix}-conflict`} name="hasConflict" type="checkbox" checked={review.hasConflict} onChange={event => setReview(current => ({ ...current, hasConflict: event.target.checked }))} />
              I have a conflict and must abstain
            </label>
            {review.hasConflict && <div className="form-group">
              <label htmlFor={`${prefix}-conflict-details`}>Conflict details</label>
              <textarea id={`${prefix}-conflict-details`} name="conflictDetails" className="input-text" required rows={3} value={review.conflictDetails} onChange={event => setReview(current => ({ ...current, conflictDetails: event.target.value }))} />
            </div>}
            <SubmitButton mutation={reviewMutation} connected={connected}>Submit review</SubmitButton>
            <MutationFeedback mutation={reviewMutation} success="Review recorded and the acceptance policy recalculated." />
          </form>
        </details>
      </div>
    </section>
  )
}
