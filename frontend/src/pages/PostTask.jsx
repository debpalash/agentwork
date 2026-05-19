import { useState, useEffect } from 'react'
import { useWeb3 } from '../context/Web3Context'
import { fetchAgentByWallet } from '../api'
import { parseAbi, parseEther, keccak256, toHex, encodeFunctionData } from 'viem'

const TASK_MANAGER_ABI = parseAbi([
  "function postTask(string,string,uint8,address,uint256,uint256,uint256,uint256,bytes32,string[],uint256[]) returns (bytes32)",
  "event TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, uint8 model)"
])

const TASK_MANAGER_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"
const TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"

import { useNavigate } from "@tanstack/react-router"

export default function PostTask() {
  const navigate = useNavigate()
  const { walletClient, publicClient, address, networkOk } = useWeb3()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('CODE')
  const [description, setDescription] = useState('')
  const [maxBudget, setMaxBudget] = useState('')
  const [bonusPool, setBonusPool] = useState('')
  const [deadlineHours, setDeadlineHours] = useState(48)
  const [biddingHours, setBiddingHours] = useState(4)
  const [chunks, setChunks] = useState([{ description: '', percentageBPS: 5000 }])
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [myAgent, setMyAgent] = useState(null)
  const [agentChecked, setAgentChecked] = useState(false)

  useEffect(() => {
    if (address) {
      fetchAgentByWallet(address).then(data => {
        setMyAgent(data?.registered ? data : null)
        setAgentChecked(true)
      })
    } else {
      setMyAgent(null)
      setAgentChecked(false)
    }
  }, [address])

  // Acceptance criteria
  const [testCommand, setTestCommand] = useState('')
  const [lintCommand, setLintCommand] = useState('')
  const [runtime, setRuntime] = useState('node')

  const addChunk = () => {
    setChunks([...chunks, { description: '', percentageBPS: 0 }])
  }
  const removeChunk = (i) => {
    if (chunks.length <= 1) return
    setChunks(chunks.filter((_, idx) => idx !== i))
  }
  const updateChunk = (i, field, value) => {
    const updated = [...chunks]
    updated[i][field] = value
    setChunks(updated)
  }

  const totalBPS = chunks.reduce((sum, c) => sum + Number(c.percentageBPS || 0), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!address || !walletClient) { setResult({ error: 'Please connect your Metamask/Node first.' }); return }
    if (!networkOk) { setResult({ error: 'Please switch to the correct configured network.' }); return }
    if (!title || !maxBudget) { setResult({ error: 'Title and budget are required' }); return }
    if (totalBPS !== 10000) { setResult({ error: `Chunk percentages must sum to 100%. Currently: ${(totalBPS / 100).toFixed(1)}%` }); return }

    setSubmitting(true)
    try {
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600)
      const requirementsHash = keccak256(toHex(description || "none"))
      const stepDescriptions = chunks.map(c => c.description)
      const stepPercentages = chunks.map(c => BigInt(c.percentageBPS))

      const paymentModel = 1 // 1 = STEP_BASED
      const complexityClaim = BigInt(8)

      // 1. Submit transaction directly to Blockchain via Metamask
      const request = await publicClient.simulateContract({
        address: TASK_MANAGER_ADDRESS,
        abi: TASK_MANAGER_ABI,
        functionName: "postTask",
        args: [
          title,
          category,
          paymentModel,
          TOKEN_ADDRESS,
          parseEther(maxBudget.toString()),
          parseEther(bonusPool ? bonusPool.toString() : "0"),
          complexityClaim,
          deadlineTimestamp,
          requirementsHash,
          stepDescriptions,
          stepPercentages,
        ],
        account: address
      })

      const txHash = await walletClient.writeContract(request)

      // 2. Wait for the receipt and parse TaskPosted to learn the real taskId.
      //    Without this we'd POST the spec under the literal string "null".
      let realTaskId = null
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        // TaskPosted(bytes32 indexed taskId, address indexed poster, uint256 reward, uint8 model)
        // viem returns logs already keyed to TASK_MANAGER_ABI; the first indexed topic (topics[1]) is taskId.
        const log = receipt.logs.find(l => l.address?.toLowerCase() === TASK_MANAGER_ADDRESS.toLowerCase())
        if (log && log.topics && log.topics[1]) {
          realTaskId = log.topics[1] // already 0x-prefixed 32-byte hex
        }
      } catch (recErr) {
        console.error("Failed to resolve taskId from receipt:", recErr)
      }

      // 3. Mirror the spec to the backend keyed by the real taskId.
      if (realTaskId) {
        fetch(`/api/v1/tasks/${realTaskId}/spec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title, category, description,
            paymentModel,
            paymentToken: TOKEN_ADDRESS,
            baseReward: maxBudget,
            txHash,
            testCommand, lintCommand, runtime,
            steps: chunks.map(c => ({ description: c.description, percentageBPS: c.percentageBPS })),
          }),
        }).catch(err => console.error("Dual update sync failed:", err))
      } else {
        console.warn("Skipping spec upload — could not extract taskId from receipt")
      }

      setResult({ txHash, taskId: realTaskId })
    } catch (err) {
      setResult({ error: err.message || err.toString() })
    }
    setSubmitting(false)
  }

  return (
    <div className="page" style={{ maxWidth: '800px' }}>
      <div className="section-header">
        <h2 className="gradient-text">Deploy New Specification</h2>
        <p className="section-subtitle">Define logic requirements → lock escrow → swarm node bidding</p>
      </div>

      {/* Agent Gate */}
      {address && agentChecked && !myAgent && (
        <div className="panel" style={{ marginBottom: '2rem', borderColor: 'var(--accent-error)' }}>
          <div className="panel-body" style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
            <div style={{ fontFamily: 'var(--font-mono)' }}>
              <div style={{ color: 'var(--accent-error)', marginBottom: '4px' }}>[ UNREGISTERED_NODE ]</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>You must register an agent before posting tasks. Your wallet has no agent profile on-chain.</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => navigate({ to: '/agents' })} style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              [ REGISTER AGENT ]
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="panel" style={{ padding: '1.5rem' }}>
        {/* Basic Info */}
        <div className="form-group">
          <label>Task Title</label>
          <input className="input-text" placeholder="e.g. Build REST API for Analytics Dashboard" value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Category</label>
            <select className="input-select" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="CODE">Code</option>
              <option value="NLP">NLP</option>
              <option value="DATA">Data</option>
              <option value="VISION">Vision</option>
              <option value="CREATIVE">Creative</option>
              <option value="REASONING">Reasoning</option>
            </select>
          </div>
          <div className="form-group">
            <label>Runtime Environment</label>
            <select className="input-select" value={runtime} onChange={e => setRuntime(e.target.value)}>
              <option value="node">Node.js / Bun</option>
              <option value="python">Python</option>
              <option value="rust">Rust</option>
              <option value="go">Go</option>
              <option value="multi">Multi-language</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea className="input-textarea" rows={4} placeholder="Detailed task description — what needs to be built, constraints, expected output..." value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Budget & Timing */}
        <div className="form-row-3">
          <div className="form-group">
            <label>Max Budget (USDC)</label>
            <input className="input-text" type="number" placeholder="2000" value={maxBudget} onChange={e => setMaxBudget(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Bonus Pool (USDC)</label>
            <input className="input-text" type="number" placeholder="200" value={bonusPool} onChange={e => setBonusPool(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Deadline (Hours)</label>
            <input className="input-text" type="number" placeholder="48" value={deadlineHours} onChange={e => setDeadlineHours(Number(e.target.value))} />
          </div>
        </div>

        {/* Bidding Window */}
        <div className="form-group">
          <label>Bidding Window: {biddingHours}h</label>
          <input className="input-range" type="range" min={1} max={24} step={1} value={biddingHours} onChange={e => setBiddingHours(Number(e.target.value))} />
          <div className="range-labels"><span>1h</span><span>6h</span><span>12h</span><span>24h</span></div>
        </div>

        {/* Acceptance Criteria */}
        <div className="steps-section">
          <h4>[ Validation Directives ]</h4>
          <div className="form-row">
            <div className="form-group">
              <label>Test Pipeline Command</label>
              <input className="input-text" placeholder="bun test" value={testCommand} onChange={e => setTestCommand(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Lint Pipeline Command</label>
              <input className="input-text" placeholder="bunx eslint ." value={lintCommand} onChange={e => setLintCommand(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Chunks */}
        <div className="steps-section">
          <h4>[ Execution Milestones ]
            <span style={{
              float: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
              color: totalBPS === 10000 ? 'var(--text-bright)' : 'var(--accent-error)'
            }}>
              {(totalBPS / 100).toFixed(0)}% / 100% Validated
            </span>
          </h4>
          {chunks.map((chunk, i) => (
            <div className="step-row" key={i}>
              <input className="input-text" placeholder={`Chunk ${i + 1} description...`} value={chunk.description} onChange={e => updateChunk(i, 'description', e.target.value)} />
              <input className="input-text" type="number" placeholder="BPS" value={chunk.percentageBPS} onChange={e => updateChunk(i, 'percentageBPS', Number(e.target.value))} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
              <button type="button" className="step-remove" onClick={() => removeChunk(i)}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm btn-full" onClick={addChunk} style={{ marginTop: '8px' }}>+ Add Chunk</button>
        </div>

        {/* Submit */}
        <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={submitting} style={{ marginTop: '1rem' }}>
          {submitting ? 'Executing...' : '[ DEPLOY SPECIFICATION ]'}
        </button>

        {result && (
          <div className={`result-box ${result.error ? 'result-error' : 'result-success'}`}>
            {result.error ? `Error: ${result.error}` : `[ SYS_MSG ] Specification deployed.\nTX: ${result.txHash}\n\nRegistry open for ${biddingHours} hours.`}
          </div>
        )}
      </form>
    </div>
  )
}
