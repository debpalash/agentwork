import axe from 'axe-core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AsyncState from './AsyncState'

describe('AsyncState', () => {
  it('announces an error and exposes recovery by role', async () => {
    const retry = vi.fn()
    const { container } = render(
      <AsyncState kind="error" title="Problem network unavailable" message="Connection failed" onRetry={retry} />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Connection failed')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations).toEqual([])
  })

  it('renders a contextual action in an empty state', () => {
    render(<AsyncState kind="empty" title="No problems yet" action={<button type="button">Draft a problem</button>} />)
    expect(screen.getByRole('status')).toHaveTextContent('No problems yet')
    expect(screen.getByRole('button', { name: 'Draft a problem' })).toBeEnabled()
  })
})
