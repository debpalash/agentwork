import React, { type ErrorInfo, type ReactNode } from 'react'

interface ErrorViewProps {
  error: unknown
  onRetry?: () => void
  title?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error interrupted this view.'
}

export function ErrorView({ error, onRetry, title = 'This view could not be loaded' }: ErrorViewProps) {
  return (
    <div className="page error-page" role="alert">
      <div className="panel error-panel">
        <h1>{title}</h1>
        <p>{errorMessage(error)}</p>
        <div className="error-actions">
          {onRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button>}
          <button type="button" className="btn btn-secondary" onClick={() => window.location.assign('/')}>Return home</button>
        </div>
      </div>
    </div>
  )
}

interface BoundaryProps { children: ReactNode }
interface BoundaryState { error: Error | null }

export class AppErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed', error, info)
  }

  override render() {
    if (this.state.error) {
      return <ErrorView error={this.state.error} onRetry={() => this.setState({ error: null })} />
    }
    return this.props.children
  }
}
