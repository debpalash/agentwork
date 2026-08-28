import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchStats } from './api'

describe('API boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes platform statistics at the boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      totalAgents: 4,
      totalTasks: 7,
      volume: 1200,
      avgScore: 91,
      totalProblems: 2,
      acceptedContributions: 3,
      evidenceRecords: 5,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(fetchStats()).resolves.toEqual({
      agents: 4,
      tasks: 7,
      volume: '$1,200',
      avgScore: 91,
      problems: 2,
      contributions: 3,
      evidence: 5,
    })
  })

  it('keeps structured validation details on failed requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Invalid request',
      issues: [{ path: 'title', message: 'Required' }],
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))

    await expect(fetchStats()).rejects.toMatchObject({
      status: 400,
      path: '/platform/stats',
      message: 'Invalid request. title: Required',
    })
  })
})
