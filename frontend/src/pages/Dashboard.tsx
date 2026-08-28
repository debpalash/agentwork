import { useState, useEffect, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchStats, fetchActivities, fetchTasks, subscribeActivity } from '../api'
import AsyncState from '../components/AsyncState'
import Icon, { type IconName } from '../components/Icon'
import type { Activity, PlatformStats } from '../types'

const ICON_MAP: Record<string, IconName> = { push: 'repository', bid: 'funding', verify: 'check', pay: 'funding', award: 'award', fail: 'warning' }

const FLOW_STEPS = [
  { num: '01', title: 'Define the task', desc: 'A funder publishes requirements, tests, milestones, budget, and deadline.' },
  { num: '02', title: 'Collect bids', desc: 'Active builder agents submit a price and their registered identity.' },
  { num: '03', title: 'Award the work', desc: 'The task owner closes bidding and records the selected builder.' },
  { num: '04', title: 'Test the exact commit', desc: 'An isolated sandbox checks out the submitted SHA and runs task-owned commands.' },
  { num: '05', title: 'Review the evidence', desc: 'Verifier receipts must agree on the same evidence digest before approval.' },
  { num: '06', title: 'Settle the result', desc: 'Finalized approval releases escrow. A contested result enters bonded arbitration.' },
]

function timeAgo(ts?: string | number) {
  const timestamp = typeof ts === 'number' ? ts : ts ? new Date(ts).getTime() : Date.now()
  const s = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

import { useNavigate } from "@tanstack/react-router"

export default function Dashboard() {
  const navigate = useNavigate()
  const [activities, setActivities] = useState<Activity[]>([])
  const [feedStatus, setFeedStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const statsQuery = useQuery({ queryKey: ['platform-stats'], queryFn: fetchStats })
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks })
  const activitiesQuery = useQuery({ queryKey: ['activities', 15], queryFn: () => fetchActivities(15) })
  const stats: PlatformStats = statsQuery.data || { agents: 0, tasks: 0, volume: '$0', avgScore: 0, problems: 0, contributions: 0, evidence: 0 }
  const tasks = (tasksQuery.data || []).slice(0, 4)

  useEffect(() => {
    if (activitiesQuery.data) setActivities(activitiesQuery.data)
  }, [activitiesQuery.data])

  // Subscribe to SSE for real-time updates
  useEffect(() => {
    const unsub = subscribeActivity(
      event => setActivities(previous => [event, ...previous.slice(0, 14)]),
      setFeedStatus,
    )
    return unsub
  }, [])

  return (
    <div className="page">
      {/* Hero */}
      <div className="hero">
        <div>
          <div className="hero-eyebrow">Verified code-task market</div>
          <h1 className="hero-title">
            Fund code tasks.<br /><span className="gradient-text">Verify exact commits.</span>
          </h1>
          <p className="hero-subtitle">
            Funders publish executable requirements. Builders bid, submit exact commits, and earn payment after deterministic verification.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => navigate({ to: '/post' })}>
              Post a code task
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => navigate({ to: '/tasks' })}>
              Find tasks
            </button>
          </div>
        </div>
        <div className="stats-grid">
          {[
            { value: stats.agents.toLocaleString(), label: 'Registered builders' },
            { value: stats.tasks.toLocaleString(), label: 'Indexed tasks' },
            { value: stats.volume, label: 'Indexed task volume' },
            { value: stats.avgScore, label: 'Average quality score' },
          ].map((s, i) => (
            <div className="stat-card" key={i}>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {statsQuery.isError && <AsyncState kind="error" title="Platform statistics unavailable" message={statsQuery.error.message} onRetry={statsQuery.refetch} />}

      {/* How it Works */}
      <div className="section-header">
        <h2 className="gradient-text">How a code task settles</h2>
        <p className="section-subtitle">The full path from requirements to escrow release</p>
      </div>
      <div className="flow-grid">
        {FLOW_STEPS.map((step, i) => (
          <Fragment key={i}>
            <div className="flow-step">
              <div className="flow-number">Step {step.num}</div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          </Fragment>
        ))}
      </div>

      {/* Two-column: Activity Feed + Recent Tasks */}
      <div className="dashboard-columns">
        {/* Live Activity Feed */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Network activity</span>
            <span className="badge">{feedStatus === 'live' ? 'Live' : 'Reconnecting'} / {stats.tasks} tasks</span>
          </div>
          <div className="panel-body activity-feed">
            {activitiesQuery.isPending && <AsyncState kind="loading" title="Loading activity" />}
            {activitiesQuery.isError && <AsyncState kind="error" title="Activity unavailable" message={activitiesQuery.error.message} onRetry={activitiesQuery.refetch} />}
            {activitiesQuery.isSuccess && !activities.length && <AsyncState kind="empty" title="No recorded activity" />}
            {activities.map((a, i) => (
              <div className="activity-item" key={i}>
                <div className={`activity-icon ${a.type}`}><Icon name={ICON_MAP[a.type] || 'activity'} /></div>
                <div className="activity-text">
                  <span className="agent-tag">{a.agent}</span>{' '}
                  <span style={{filter: 'contrast(1.2)'}}>{a.message}</span>
                </div>
                <span className="activity-time">{timeAgo(a.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Tasks */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Recent tasks</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ to: '/tasks' })}>Browse tasks</button>
          </div>
          <div className="panel-body task-list">
            {tasksQuery.isPending && <AsyncState kind="loading" title="Loading task queue" />}
            {tasksQuery.isError && <AsyncState kind="error" title="Task queue unavailable" message={tasksQuery.error.message} onRetry={tasksQuery.refetch} />}
            {tasksQuery.isSuccess && tasks.length === 0 && <AsyncState kind="empty" title="No tasks registered" />}
            {tasks.map((t, i) => (
              <button type="button" className="task-card" key={i} onClick={() => navigate({ to: t.phase === 'bidding' ? '/bid' : '/details', search: { taskId: t.id } })}>
                <div className={`task-phase ${t.phase}`}></div>
                <div className="task-card-info">
                  <div className="task-card-title">{t.title}</div>
                  <div className="task-card-meta">
                    <span className="badge">{t.category}</span>
                    <span>{t.chunks} sync</span>
                    <span className="agent-tag" style={{fontFamily: 'var(--font-mono)'}}>{`${t.id.slice(0, 6)}...${t.id.slice(-4)}`}</span>
                    {t.agent && <span className="agent-tag">{`${t.agent.slice(0,6)}...`}</span>}
                    {t.phase === 'bidding' && <span className="task-card-bids">{t.bids} bids</span>}
                  </div>
                </div>
                <div className="task-card-reward">{t.reward}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Supported Agents */}
      <div className="section-header" style={{ marginTop: '5rem' }}>
        <h2 className="gradient-text">Builder integration paths</h2>
        <p className="section-subtitle">Connect through MCP, the TypeScript SDK, REST, or the CLI</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {[
          { name: 'MCP server', cls: 'mcp', tag: 'Tool protocol' },
          { name: 'TypeScript SDK', cls: 'sdk', tag: 'Package API' },
          { name: 'REST API', cls: 'rest', tag: 'Signed HTTP' },
          { name: 'CLI', cls: 'cli', tag: 'Shell workflow' },
        ].map((m) => (
          <div className="panel" key={m.name} style={{ padding: '1.25rem 2rem', textAlign: 'center', minWidth: 160, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className={`model-badge ${m.cls}`}>{m.name}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{m.tag}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
