import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createProblem, fetchProblemGraph, fetchProblems } from '../api'
import { useWeb3 } from '../context/Web3Context'
import AsyncState from '../components/AsyncState'
import ProblemActions from '../components/ProblemActions'
import type { FundingMechanism, FundingPool, Notice, Problem, ProblemDomain, ProblemRiskTier, ProblemSpec, VerificationMode } from '../types'

const domains: ProblemDomain[] = ['SOFTWARE', 'MATHEMATICS', 'DATA', 'AI_ML', 'RESEARCH', 'BIOMEDICAL', 'CLIMATE', 'ENGINEERING', 'POLICY', 'OTHER']
const fundingMechanisms: FundingMechanism[] = ['GRANT', 'MILESTONE', 'PRIZE', 'REPLICATION_BOUNTY', 'RETROACTIVE']

export const formatDecimal = (value: string | number) => String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')

interface ProblemForm {
  title: string
  summary: string
  description: string
  domain: ProblemDomain
  riskTier: ProblemRiskTier
  license: string
  tags: string
  verificationMode: VerificationMode
  acceptanceCriteria: string
  minimumIndependentReviews: number | string
  replicationRequired: boolean
  fundingAmount: string
  fundingToken: string
  fundingMechanism: FundingMechanism
}

const initialForm: ProblemForm = {
  title: '', summary: '', description: '', domain: 'SOFTWARE',
  riskTier: 'LOW', license: 'CC-BY-4.0', tags: '',
  verificationMode: 'CODE', acceptanceCriteria: '',
  minimumIndependentReviews: 2, replicationRequired: false,
  fundingAmount: '', fundingToken: 'USDC', fundingMechanism: 'GRANT',
}

function FundingSummary({ pools }: { pools: FundingPool[] }) {
  if (!pools.length) return <p className="problem-muted">No funding pledges recorded.</p>
  return (
    <div className="funding-list">
      {pools.map(pool => (
        <div className="funding-row" key={pool.id}>
          <div><strong>{formatDecimal(pool.committed_amount)} {pool.token}</strong><span>{pool.mechanism.replaceAll('_', ' ')}</span></div>
          <span className={`funding-status funding-${pool.status.toLowerCase()}`}>{pool.status}</span>
        </div>
      ))}
      <p className="action-caveat">PLEDGED means intent is recorded. It is not proof that money is escrowed or settled.</p>
    </div>
  )
}

export default function Problems() {
  const queryClient = useQueryClient()
  const { address, walletClient, connectWallet } = useWeb3()
  const [domain, setDomain] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [form, setForm] = useState<ProblemForm>(initialForm)

  const problemsQuery = useQuery({
    queryKey: ['problems', domain],
    queryFn: () => fetchProblems({ domain: domain || undefined, status: 'ALL' }),
  })
  const graphQuery = useQuery({
    queryKey: ['problem-graph', selectedId],
    queryFn: () => fetchProblemGraph(selectedId as string),
    enabled: Boolean(selectedId),
  })
  const createMutation = useMutation<{ problem: Problem; safetyReviewRequired?: boolean }, Error, ProblemSpec>({
    mutationFn: spec => createProblem(spec, { address, walletClient }),
    onSuccess: async response => {
      setNotice({ type: 'success', message: `Problem published${response.safetyReviewRequired ? ' and quarantined for institutional review' : ''}: ${response.problem.title}` })
      setShowCreate(false)
      setForm(initialForm)
      setSelectedId(response.problem.id)
      await queryClient.invalidateQueries({ queryKey: ['problems'] })
    },
    onError: error => setNotice({ type: 'error', message: error.message }),
  })

  const problems = problemsQuery.data?.problems || []
  const selected = problems.find(problem => problem.id === selectedId) || graphQuery.data?.problem
  const update = <K extends keyof ProblemForm>(key: K, value: ProblemForm[K]) => setForm(current => ({ ...current, [key]: value }))

  const inspect = (problem: Problem) => {
    setSelectedId(problem.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice(null)
    if (!address || !walletClient) {
      await connectWallet()
      setNotice({ type: 'info', message: 'Wallet connection requested. Review the charter, then publish once the connected address appears in the navigation.' })
      return
    }
    const isBiomedical = form.domain === 'BIOMEDICAL'
    const hasFunding = form.fundingAmount.trim().length > 0
    const spec: ProblemSpec = {
      version: '1.0',
      title: form.title,
      summary: form.summary,
      description: form.description,
      domain: form.domain,
      visibility: 'PUBLIC',
      riskTier: isBiomedical ? 'HIGH' : form.riskTier,
      tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      license: form.license,
      funding: hasFunding ? {
        amount: form.fundingAmount,
        token: form.fundingToken,
        mechanisms: [form.fundingMechanism],
      } : { mechanisms: [] },
      verificationPolicy: {
        mode: form.verificationMode,
        minimumIndependentReviews: isBiomedical ? Math.max(3, Number(form.minimumIndependentReviews)) : Number(form.minimumIndependentReviews),
        replicationRequired: isBiomedical || form.replicationRequired,
        minimumReplications: isBiomedical ? 2 : form.replicationRequired ? 1 : 0,
        artifactRequirements: ['METHODS', 'RESULTS', 'LICENSE'],
        acceptanceCriteria: form.acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean),
      },
      governance: { reviewerSelection: 'HYBRID', appealsAllowed: true, conflictDisclosureRequired: true },
      ethics: {
        humanSubjects: false,
        sensitiveData: false,
        dualUse: false,
        institutionalApprovalRequired: isBiomedical,
        consentBasis: 'NOT_APPLICABLE',
        dataClassification: 'PUBLIC',
        securityStandard: 'NONE',
        highRiskLifeSciences: 'NONE',
        jurisdiction: 'UNSPECIFIED',
        requirements: isBiomedical ? ['Institutional safety and ethics review before activation'] : [],
      },
      metadata: {},
    }
    createMutation.mutate(spec)
  }

  return (
    <div className="page problem-page">
      <div className="problem-hero">
        <div>
          <span className="protocol-label">PROBLEM PROTOCOL v1</span>
          <h1>Coordinate evidence around problems that matter.</h1>
          <p>Funders define rigorous charters. Human and agent contributors split the work, register artifacts, attach evidence, and earn credit only after independent review.</p>
        </div>
        <button className="btn btn-primary" type="button" aria-expanded={showCreate} onClick={() => setShowCreate(value => !value)}>
          {showCreate ? 'Close charter' : 'Draft a problem'}
        </button>
      </div>

      {notice && <div className={`problem-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.message}</div>}

      {selectedId && (
        <section className="problem-inspector panel" aria-labelledby="selected-problem-title">
          <div className="problem-inspector-head">
            <div><span className="protocol-label">PUBLIC EVIDENCE GRAPH</span><h2 id="selected-problem-title">{selected?.title || 'Problem'}</h2></div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSelectedId(null)}>Close</button>
          </div>
          {graphQuery.isPending && <AsyncState kind="loading" title="Loading evidence graph" message="Reading public workstreams, artifacts, evidence, reviews, and credit records." />}
          {graphQuery.isError && <AsyncState kind="error" title="Evidence graph unavailable" message={graphQuery.error.message} onRetry={graphQuery.refetch} />}
          {graphQuery.data && (() => {
            const { problem, graph, counts } = graphQuery.data
            return <>
              <p className="problem-inspector-summary">{problem.description}</p>
              <div className="problem-metadata" aria-label="Problem policy summary">
                <span>{problem.domain}</span><span>{problem.status}</span><span>{problem.riskTier} RISK</span><span>{problem.verificationPolicy.mode.replaceAll('_', ' ')}</span><span>{problem.verificationPolicy.minimumIndependentReviews} INDEPENDENT REVIEWS</span>
              </div>
              <div className="problem-counts">
                {Object.entries(counts).map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}
              </div>
              <div className="problem-graph-columns">
                <section><h3>Funding</h3><FundingSummary pools={graph.fundingPools} /></section>
                <section><h3>Workstreams</h3>{graph.workstreams.map(item => <div className="graph-row" key={item.id}><span>{item.status}</span><strong>{item.title}</strong></div>)}{!graph.workstreams.length && <p>No workstreams yet.</p>}</section>
                <section><h3>Contributions</h3>{graph.contributions.map(item => <div className="graph-row" key={item.id}><span>{item.status}</span><strong>{item.title}</strong><small>{item.artifact_type}</small></div>)}{!graph.contributions.length && <p>No contributions yet.</p>}</section>
              </div>
              <div className="problem-ledger-grid">
                <section><h3>Evidence</h3>{graph.evidence.map(item => <div className="graph-row" key={item.id}><span>{item.evidence_type}</span><strong>{item.uri}</strong></div>)}{!graph.evidence.length && <p>No evidence attached.</p>}</section>
                <section><h3>Independent reviews</h3>{graph.reviews.map(item => <div className="graph-row" key={item.id}><span>{item.verdict}</span><strong>{item.score ?? 'No score'} / 100</strong></div>)}{!graph.reviews.length && <p>No reviews submitted.</p>}</section>
                <section><h3>Verified credit</h3>{graph.credits.map(item => <div className="graph-row" key={`${item.contribution_id}-${item.contributor_id}-${item.role}`}><span>{item.role}</span><strong>{item.contributor_id}</strong><small>{Number(item.share_bps) / 100}%</small></div>)}{!graph.credits.length && <p>No accepted contribution credit yet.</p>}</section>
              </div>
              <ProblemActions
                problem={problem}
                graph={graph}
                address={address}
                walletClient={walletClient}
                connectWallet={connectWallet}
                onChanged={async () => {
                  await Promise.all([graphQuery.refetch(), queryClient.invalidateQueries({ queryKey: ['problems'] })])
                }}
              />
            </>
          })()}
        </section>
      )}

      {showCreate && (
        <form className="panel problem-form" onSubmit={submit}>
          <div className="problem-form-heading">
            <div><span>01</span><h2>Problem charter</h2></div>
            <p>Draft first. A wallet signature is requested only when you publish. The charter fixes scope, safety, and acceptance policy.</p>
          </div>
          <div className="form-group">
            <label htmlFor="problem-title">Problem title</label>
            <input id="problem-title" name="title" className="input-text" required minLength={8} maxLength={180} value={form.title} onChange={event => update('title', event.target.value)} placeholder="Prove a bounded case of…" />
          </div>
          <div className="form-group">
            <label htmlFor="problem-summary">One-paragraph summary</label>
            <textarea id="problem-summary" name="summary" className="input-text" required minLength={20} maxLength={500} rows={3} value={form.summary} onChange={event => update('summary', event.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="problem-description">Full context, constraints, and non-goals</label>
            <textarea id="problem-description" name="description" className="input-text" required minLength={50} rows={7} value={form.description} onChange={event => update('description', event.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="problem-domain">Domain</label><select id="problem-domain" name="domain" className="input-select" value={form.domain} onChange={event => update('domain', event.target.value as ProblemDomain)}>{domains.map(item => <option key={item}>{item}</option>)}</select></div>
            <div className="form-group"><label htmlFor="problem-risk">Risk tier</label><select id="problem-risk" name="riskTier" className="input-select" disabled={form.domain === 'BIOMEDICAL'} value={form.domain === 'BIOMEDICAL' ? 'HIGH' : form.riskTier} onChange={event => update('riskTier', event.target.value as ProblemRiskTier)}><option>LOW</option><option>MODERATE</option><option>HIGH</option><option>RESTRICTED</option></select></div>
            <div className="form-group"><label htmlFor="problem-license">Output license</label><input id="problem-license" name="license" className="input-text" required value={form.license} onChange={event => update('license', event.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="problem-verification">Verification mode</label><select id="problem-verification" name="verificationMode" className="input-select" value={form.verificationMode} onChange={event => update('verificationMode', event.target.value as VerificationMode)}><option>CODE</option><option>FORMAL_PROOF</option><option>REPRODUCIBLE_RESEARCH</option><option>EXPERT_PANEL</option><option>HYBRID</option></select></div>
            <div className="form-group"><label htmlFor="problem-reviews">Independent reviews</label><input id="problem-reviews" name="minimumIndependentReviews" className="input-text" type="number" min="1" max="25" value={form.minimumIndependentReviews} onChange={event => update('minimumIndependentReviews', event.target.value)} /></div>
          </div>
          <div className="form-group">
            <label htmlFor="problem-criteria">Acceptance criteria, one per line</label>
            <textarea id="problem-criteria" name="acceptanceCriteria" className="input-text" required rows={5} value={form.acceptanceCriteria} onChange={event => update('acceptanceCriteria', event.target.value)} placeholder={'Results are reproducible from disclosed inputs\nAt least two independent reviewers accept the evidence'} />
          </div>
          <fieldset className="problem-fieldset">
            <legend>Initial funding pledge <span>(optional)</span></legend>
            <p>Recorded as a public pledge only. No token transfer or escrow occurs through this form.</p>
            <div className="form-row">
              <div className="form-group"><label htmlFor="problem-funding-amount">Amount</label><input id="problem-funding-amount" name="fundingAmount" className="input-text" inputMode="decimal" pattern="[0-9]+([.][0-9]+)?" value={form.fundingAmount} onChange={event => update('fundingAmount', event.target.value)} /></div>
              <div className="form-group"><label htmlFor="problem-funding-token">Token or currency</label><input id="problem-funding-token" name="fundingToken" className="input-text" value={form.fundingToken} onChange={event => update('fundingToken', event.target.value)} /></div>
              <div className="form-group"><label htmlFor="problem-funding-mechanism">Mechanism</label><select id="problem-funding-mechanism" name="fundingMechanism" className="input-select" value={form.fundingMechanism} onChange={event => update('fundingMechanism', event.target.value as FundingMechanism)}>{fundingMechanisms.map(item => <option key={item}>{item}</option>)}</select></div>
            </div>
          </fieldset>
          <div className="form-row">
            <div className="form-group"><label htmlFor="problem-tags">Tags</label><input id="problem-tags" name="tags" className="input-text" value={form.tags} onChange={event => update('tags', event.target.value)} placeholder="formal-methods, climate, open-data" /></div>
            <label className="problem-check" htmlFor="problem-replication"><input id="problem-replication" name="replicationRequired" type="checkbox" checked={form.replicationRequired} onChange={event => update('replicationRequired', event.target.checked)} /> Require independent replication</label>
          </div>
          {form.domain === 'BIOMEDICAL' && <div className="problem-safety">Biomedical problems enter quarantine for institutional safety and ethics review. Funding cannot bypass this gate.</div>}
          <button className="btn btn-primary btn-full" disabled={createMutation.isPending}>{createMutation.isPending ? 'Signing charter…' : address ? 'Sign and publish charter' : 'Connect wallet to publish'}</button>
        </form>
      )}

      <div className="problem-toolbar">
        <div><span className="protocol-label">DISCOVERY</span><h2>Open problem network</h2></div>
        <div className="problem-filter"><label htmlFor="problem-domain-filter">Filter by domain</label><select id="problem-domain-filter" name="domainFilter" className="input-select" value={domain} onChange={event => setDomain(event.target.value)}><option value="">ALL DOMAINS</option>{domains.map(item => <option key={item}>{item}</option>)}</select></div>
      </div>

      {problemsQuery.isPending && <AsyncState kind="loading" title="Loading public problems" />}
      {problemsQuery.isError && <AsyncState kind="error" title="Problem network unavailable" message={problemsQuery.error.message} onRetry={problemsQuery.refetch} />}
      {problemsQuery.isSuccess && (
        <div className="problem-grid">
          {problems.map(problem => (
            <button className="problem-card" type="button" key={problem.id} onClick={() => inspect(problem)} aria-label={`Inspect ${problem.title}`}>
              <div className="problem-card-top"><span>{problem.domain}</span><span className={`risk-${problem.riskTier?.toLowerCase()}`}>{problem.riskTier}</span></div>
              <h3>{problem.title}</h3>
              <p>{problem.summary}</p>
              <div className="problem-tags">{(problem.tags || []).map(tag => <span key={tag}>#{tag}</span>)}</div>
              <div className="problem-card-bottom"><span>{problem.status}</span><span>{problem.verificationPolicy?.minimumIndependentReviews} reviews · {problem.verificationPolicy?.replicationRequired ? 'replication required' : 'replication optional'} · inspect</span></div>
            </button>
          ))}
          {!problems.length && <AsyncState kind="empty" title="No matching public problems" message="Change the domain filter or draft a rigorous charter." />}
        </div>
      )}
    </div>
  )
}
