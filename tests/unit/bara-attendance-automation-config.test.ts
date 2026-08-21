import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
  crons?: Array<{ path?: string; schedule?: string }>
}

describe('Bara attendance automation deployment configuration', () => {
  it('registers separate Hobby-compatible daily schedule and reconciliation workers', () => {
    const jobs = (vercel.crons ?? []).filter((cron) =>
      cron.path?.startsWith('/api/cron/bara-attendance-'),
    )
    expect(jobs).toEqual([
      {
        path: '/api/cron/bara-attendance-automation',
        schedule: '15 8 * * *',
      },
      {
        path: '/api/cron/bara-attendance-reconciliation',
        schedule: '45 8 * * *',
      },
    ])
  })
})
