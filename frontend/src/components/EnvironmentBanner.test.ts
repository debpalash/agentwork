import { describe, expect, it } from 'vitest'
import { environmentDetails } from './EnvironmentBanner'

describe('environmentDetails', () => {
  it('labels local records as demonstration data', () => {
    expect(environmentDetails(31337)).toMatchObject({
      label: 'Local demo',
      mode: 'seeded-demo',
    })
    expect(environmentDetails(31337).message).toContain('not production adoption metrics')
  })

  it('distinguishes testnet from live state', () => {
    expect(environmentDetails(84532).mode).toBe('testnet')
    expect(environmentDetails(8453).mode).toBe('live')
  })
})

