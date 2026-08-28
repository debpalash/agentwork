import { useState, type FormEvent } from 'react'
import { useWeb3 } from '../context/Web3Context'
import { walletAuthHeaders } from '../api'
import { parseAbi, parseUnits, keccak256, toHex, type Address, type Hex } from 'viem'

const TASK_MANAGER_ABI = parseAbi([
  "function postTask(string,string,uint8,address,uint256,uint256,uint256,uint256,bytes32,string[],uint256[]) returns (bytes32)",
  "event TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, uint8 model)"
])
const ERC20_ABI = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"])

const TASK_MANAGER_ADDRESS = import.meta.env.VITE_TASK_MANAGER_ADDRESS || (import.meta.env.DEV ? "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" : null)
const ESCROW_VAULT_ADDRESS = import.meta.env.VITE_ESCROW_VAULT_ADDRESS || (import.meta.env.DEV ? "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" : null)
const TOKEN_ADDRESS = import.meta.env.VITE_PAYMENT_TOKEN_ADDRESS || (import.meta.env.DEV ? "0x5FbDB2315678afecb367f032d93F642f64180aa3" : null)
const TOKEN_DECIMALS = Number(import.meta.env.VITE_PAYMENT_TOKEN_DECIMALS || 18)
interface TaskChunk { description: string; percentageBPS: number }
type PostResult = { error: string; txHash?: never; taskId?: never } | { txHash: Hex; taskId: Hex; error?: never }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function PostTask() {
  const { walletClient, publicClient, address, networkOk } = useWeb3()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('CODE')
  const [description, setDescription] = useState('')
  const [maxBudget, setMaxBudget] = useState('')
  const [bonusPool, setBonusPool] = useState('')
  const [deadlineHours, setDeadlineHours] = useState(48)
  const [biddingHours, setBiddingHours] = useState(4)
  const [chunks, setChunks] = useState<TaskChunk[]>([{ description: '', percentageBPS: 10000 }])
  const [result, setResult] = useState<PostResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Acceptance criteria
  const [testCommand, setTestCommand] = useState('')
  const [lintCommand, setLintCommand] = useState('')
  const [runtime, setRuntime] = useState('node')

  const addChunk = () => {
    setChunks([...chunks, { description: '', percentageBPS: 0 }])
  }
  const removeChunk = (i: number) => {
    if (chunks.length <= 1) return
    setChunks(chunks.filter((_, idx) => idx !== i))
  }
  const updateChunk = <K extends keyof TaskChunk>(i: number, field: K, value: TaskChunk[K]) => {
    const updated = [...chunks]
    const chunk = updated[i]
    if (!chunk) return
    updated[i] = { ...chunk, [field]: value }
    setChunks(updated)
  }

  const totalBPS = chunks.reduce((sum, c) => sum + Number(c.percentageBPS || 0), 0)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!address || !walletClient || !publicClient) { setResult({ error: 'Connect the funder wallet before posting a task.' }); return }
    if (!networkOk) { setResult({ error: 'Please switch to the correct configured network.' }); return }
    if (!TASK_MANAGER_ADDRESS || !ESCROW_VAULT_ADDRESS || !TOKEN_ADDRESS) { setResult({ error: 'Production contract addresses are not configured.' }); return }
    if (!title || !maxBudget) { setResult({ error: 'Title and budget are required' }); return }
    if (!testCommand.trim()) { setResult({ error: 'A deterministic test command is required' }); return }
    if (totalBPS !== 10000) { setResult({ error: `Chunk percentages must sum to 100%. Currently: ${(totalBPS / 100).toFixed(1)}%` }); return }

    setSubmitting(true)
    try {
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600)
      const requirementsHash = keccak256(toHex(description || "none"))
      const stepDescriptions = chunks.map(c => c.description)
      const stepPercentages = chunks.map(c => BigInt(c.percentageBPS))

      const paymentModel = 1 // 1 = STEP_BASED
      const complexityClaim = BigInt(8)

      // Escrow pulls the full budget from the employer during postTask.
      const escrowAmount = parseUnits(maxBudget.toString(), TOKEN_DECIMALS) + parseUnits(bonusPool ? bonusPool.toString() : "0", TOKEN_DECIMALS)
      const approveHash = await walletClient.writeContract({
        account: address,
        chain: undefined,
        address: TOKEN_ADDRESS as Address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [ESCROW_VAULT_ADDRESS as Address, escrowAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })

      const txHash = await walletClient.writeContract({
        account: address,
        chain: undefined,
        address: TASK_MANAGER_ADDRESS as Address,
        abi: TASK_MANAGER_ABI,
        functionName: "postTask",
        args: [
          title,
          category,
          paymentModel,
          TOKEN_ADDRESS as Address,
          parseUnits(maxBudget.toString(), TOKEN_DECIMALS),
          parseUnits(bonusPool ? bonusPool.toString() : "0", TOKEN_DECIMALS),
          complexityClaim,
          deadlineTimestamp,
          requirementsHash,
          stepDescriptions,
          stepPercentages,
        ],
      })

      // 2. Wait for the receipt and parse TaskPosted to learn the real taskId.
      //    Without this we'd POST the spec under the literal string "null".
      let realTaskId: Hex | null = null
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        // TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, uint8 model)
        // viem returns logs already keyed to TASK_MANAGER_ABI; the first indexed topic (topics[1]) is taskId.
        const log = receipt.logs.find(l => l.address?.toLowerCase() === TASK_MANAGER_ADDRESS.toLowerCase())
        if (log && log.topics && log.topics[1]) {
          realTaskId = log.topics[1]
        }
      } catch (recErr) {
        console.error("Failed to resolve taskId from receipt:", recErr)
      }

      // 3. Mirror the spec to the backend keyed by the real taskId.
      if (realTaskId) {
        const specBody = JSON.stringify({
          title, category, description,
          paymentModel,
          paymentToken: TOKEN_ADDRESS,
          baseReward: maxBudget,
          txHash,
          testCommand, lintCommand, runtime, biddingHours,
          steps: chunks.map(c => ({ description: c.description, percentageBPS: c.percentageBPS })),
        })
        const authHeaders = await walletAuthHeaders(`/api/v1/tasks/${realTaskId}/spec`, 'POST', specBody, address, walletClient)
        const specResponse = await fetch(`/api/v1/tasks/${realTaskId}/spec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: specBody,
        })
        if (!specResponse.ok) {
          const body = await specResponse.json().catch(() => ({})) as { error?: string }
          throw new Error(`Task posted on-chain, but repository/spec provisioning failed: ${body.error || specResponse.status}`)
        }
      } else {
        throw new Error('Task posted on-chain, but its task ID could not be resolved for verification setup')
      }

      setResult({ txHash, taskId: realTaskId })
    } catch (err) {
      setResult({ error: errorMessage(err) })
    }
    setSubmitting(false)
  }

  return (
    <div className="page page-form">
      <div className="section-header section-header-left">
        <span className="eyebrow">Funder workflow</span>
        <h1>Post a verified code task</h1>
        <p className="section-subtitle">Define executable requirements, approve token escrow, and open bidding to registered builders.</p>
      </div>

      <form onSubmit={handleSubmit} className="panel" style={{ padding: '1.5rem' }}>
        {/* Basic Info */}
        <div className="form-group">
          <label htmlFor="task-title">Task title</label>
          <input id="task-title" name="title" className="input-text" required minLength={8} placeholder="e.g. Build REST API for Analytics Dashboard" value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="task-category">Category</label>
            <select id="task-category" name="category" className="input-select" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="CODE">Code</option>
              <option value="NLP">NLP</option>
              <option value="DATA">Data</option>
              <option value="VISION">Vision</option>
              <option value="CREATIVE">Creative</option>
              <option value="REASONING">Reasoning</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="task-runtime">Runtime environment</label>
            <select id="task-runtime" name="runtime" className="input-select" value={runtime} onChange={e => setRuntime(e.target.value)}>
              <option value="node">Node.js / Bun</option>
              <option value="python">Python</option>
              <option value="rust">Rust</option>
              <option value="go">Go</option>
              <option value="multi">Multi-language</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="task-description">Description</label>
          <textarea id="task-description" name="description" className="input-textarea" required minLength={20} rows={4} placeholder="What needs to be built, constraints, and expected output" value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Budget & Timing */}
        <div className="form-row-3">
          <div className="form-group">
            <label htmlFor="task-budget">Maximum budget (USDC)</label>
            <input id="task-budget" name="maxBudget" className="input-text" required type="number" min="0" step="0.000001" placeholder="2000" value={maxBudget} onChange={e => setMaxBudget(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="task-bonus">Bonus pool (USDC)</label>
            <input id="task-bonus" name="bonusPool" className="input-text" type="number" min="0" step="0.000001" placeholder="200" value={bonusPool} onChange={e => setBonusPool(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="task-deadline">Deadline (hours)</label>
            <input id="task-deadline" name="deadlineHours" className="input-text" required type="number" min="1" placeholder="48" value={deadlineHours} onChange={e => setDeadlineHours(Number(e.target.value))} />
          </div>
        </div>

        {/* Bidding Window */}
        <div className="form-group">
          <label htmlFor="task-bidding-window">Bidding window: {biddingHours}h</label>
          <input id="task-bidding-window" name="biddingHours" className="input-range" type="range" min={1} max={24} step={1} value={biddingHours} onChange={e => setBiddingHours(Number(e.target.value))} />
          <div className="range-labels"><span>1h</span><span>6h</span><span>12h</span><span>24h</span></div>
        </div>

        {/* Acceptance Criteria */}
        <div className="steps-section">
          <h2>Verification commands</h2>
          <p className="form-help">These commands run against the exact submitted commit in an isolated verifier environment.</p>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="task-test-command">Test pipeline command</label>
              <input id="task-test-command" name="testCommand" className="input-text" required placeholder="bun test" value={testCommand} onChange={e => setTestCommand(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="task-lint-command">Lint pipeline command</label>
              <input id="task-lint-command" name="lintCommand" className="input-text" placeholder="bunx eslint ." value={lintCommand} onChange={e => setLintCommand(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Chunks */}
        <div className="steps-section">
          <h2>Execution milestones
            <span style={{
              float: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
              color: totalBPS === 10000 ? 'var(--text-bright)' : 'var(--accent-error)'
            }}>
              {(totalBPS / 100).toFixed(0)}% of 100% allocated
            </span>
          </h2>
          {chunks.map((chunk, i) => (
            <div className="step-row" key={i}>
              <label className="sr-only" htmlFor={`task-chunk-${i}`}>Milestone {i + 1} description</label>
              <input id={`task-chunk-${i}`} name={`chunks[${i}].description`} className="input-text" required placeholder={`Milestone ${i + 1} description`} value={chunk.description} onChange={e => updateChunk(i, 'description', e.target.value)} />
              <label className="sr-only" htmlFor={`task-chunk-bps-${i}`}>Milestone {i + 1} share in basis points</label>
              <input id={`task-chunk-bps-${i}`} name={`chunks[${i}].percentageBPS`} className="input-text" required type="number" min="0" max="10000" placeholder="BPS" value={chunk.percentageBPS} onChange={e => updateChunk(i, 'percentageBPS', Number(e.target.value))} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
              <button type="button" className="step-remove" aria-label={`Remove milestone ${i + 1}`} onClick={() => removeChunk(i)}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm btn-full" onClick={addChunk} style={{ marginTop: '8px' }}>Add milestone</button>
        </div>

        {/* Submit */}
        <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={submitting} style={{ marginTop: '1rem' }}>
          {submitting ? 'Posting task…' : 'Approve escrow and post task'}
        </button>

        {result && (
          <div className={`result-box ${result.error ? 'result-error' : 'result-success'}`} role={result.error ? 'alert' : 'status'}>
            {result.error ? `Error: ${result.error}` : `Task posted on-chain and verifier spec provisioned.\nTX: ${result.txHash}\n\nBidding is open for ${biddingHours} hours.`}
          </div>
        )}
      </form>
    </div>
  )
}
