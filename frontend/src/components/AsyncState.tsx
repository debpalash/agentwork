import type { ReactNode } from 'react'

interface AsyncStateProps {
  kind: 'loading' | 'error' | 'empty'
  title: string
  message?: string
  onRetry?: () => unknown
  action?: ReactNode
}

export default function AsyncState({ kind, title, message, onRetry, action }: AsyncStateProps) {
  const isError = kind === 'error'
  return (
    <div className={`async-state async-state-${kind}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
      <strong>{title}</strong>
      {message && <span>{message}</span>}
      <div className="async-state-actions">
        {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Try again</button>}
        {action}
      </div>
    </div>
  )
}
