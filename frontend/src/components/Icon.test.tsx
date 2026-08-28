import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Icon from './Icon'

describe('Icon', () => {
  it('hides an icon that repeats a visible label', () => {
    const { container } = render(<Icon name="evidence" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('exposes a meaningful standalone icon', () => {
    render(<Icon name="warning" label="Safety review required" />)
    expect(screen.getByRole('img', { name: 'Safety review required' })).toBeVisible()
  })
})

