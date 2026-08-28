import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchTaskById } from '../api'
import AsyncState from '../components/AsyncState'
import Icon from '../components/Icon'

export default function TaskDetails() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { taskId?: string }
  const taskId = search.taskId

  const { data: task, isLoading, error, refetch } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTaskById(taskId as string),
    enabled: Boolean(taskId),
  })

  if (!taskId) {
    return <div className="page"><AsyncState kind="error" title="No task selected" message="Choose a task from the network to inspect its requirements and progress." /></div>
  }

  if (isLoading) {
    return <div className="page"><AsyncState kind="loading" title="Loading task" message={`Task ${taskId}`} /></div>
  }

  if (error || !task) {
    return (
      <div className="page">
        <AsyncState
          kind="error"
          title="Task details unavailable"
          message={error?.message || 'The task was not found.'}
          onRetry={refetch}
          action={<button className="btn btn-secondary btn-sm" onClick={() => navigate({ to: '/tasks' })}>Back to tasks</button>}
        />
      </div>
    )
  }

  const [verifiedPart = '0', totalPart = '0'] = String(task.chunks || '0/0').split('/')
  const verifiedChunks = Number(verifiedPart) || 0
  const totalChunks = Number(totalPart) || 0
  const chunks = task.chunkDescriptions || Array.from({ length: totalChunks }, (_, index) => `Milestone ${index + 1}`)
  const phase = String(task.phase || task.status || 'unknown').replaceAll('_', ' ')

  return (
    <div className="page page-narrow">
      <header className="section-header section-header-left">
        <span className="eyebrow">Task record</span>
        <h1>Task details</h1>
        <p className="section-subtitle mono-value">{task.id}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate({ to: '/tasks' })}>Back to tasks</button>
      </header>

      <div className="task-detail-layout">
        <section className="panel task-specification" aria-labelledby="task-requirements-title">
          <div className="panel-header">
            <h2 className="panel-title" id="task-requirements-title">Requirements and milestones</h2>
            <span className={`badge badge-status badge-${phase.toLowerCase().replaceAll(' ', '-')}`}>{phase}</span>
          </div>
          <div className="panel-body">
            <h3 className="detail-title">{task.title}</h3>
            <div className="detail-badges" aria-label="Task summary">
              <span className="badge">{task.category}</span>
              <span className="badge">Budget {task.reward || task.budget}</span>
            </div>

            <h4 className="content-label">Description</h4>
            <p className="detail-copy">{task.description || 'No description provided.'}</p>

            <div className="content-label-row">
              <h4 className="content-label">Milestones</h4>
              <span>{verifiedChunks} of {totalChunks} verified</span>
            </div>
            <div className="chunk-timeline" aria-label={`${verifiedChunks} of ${totalChunks} milestones verified`}>
              {Array.from({ length: totalChunks }).map((_, index) => (
                <span
                  key={index}
                  className={index < verifiedChunks ? 'verified' : index === verifiedChunks && task.phase === 'in_progress' ? 'current' : ''}
                  title={`Milestone ${index + 1}`}
                />
              ))}
            </div>
            <ol className="milestone-list">
              {chunks.map((chunk, index) => (
                <li key={index} className={index < verifiedChunks ? 'verified' : ''}>
                  <span className="milestone-number">{index + 1}</span>
                  <span>{chunk}</span>
                  {index < verifiedChunks && <span className="milestone-status"><Icon name="check" size={16} /> Verified</span>}
                </li>
              ))}
            </ol>

            {String(task.phase).toLowerCase() === 'bidding' && (
              <button className="btn btn-primary btn-full" onClick={() => navigate({ to: '/bid', search: { taskId: task.id } })}>
                Review bids
              </button>
            )}
          </div>
        </section>

        <aside className="panel task-settlement" aria-labelledby="task-settlement-title">
          <div className="panel-header">
            <h2 className="panel-title" id="task-settlement-title">Builder and settlement</h2>
          </div>
          <dl className="panel-body detail-facts">
            <div>
              <dt>Assigned builder</dt>
              <dd className="mono-value">{task.agent || 'Not assigned'}</dd>
            </div>
            <div>
              <dt>Posting wallet</dt>
              <dd className="mono-value">{task.poster || 'Not available'}</dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd className="mono-value">{task.repo || 'Not attached'}</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>{task.deadline ? new Date(Number(task.deadline) * 1000).toLocaleString() : 'Not set'}</dd>
            </div>
            <div className="detail-fact-pair">
              <div><dt>Maximum budget</dt><dd>{task.budget}</dd></div>
              <div><dt>Bonus pool</dt><dd>{task.bonusPool || '0'}</dd></div>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  )
}
