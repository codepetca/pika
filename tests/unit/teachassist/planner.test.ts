import { describe, expect, it } from 'vitest'
import { planOperations } from '@/lib/teachassist/planner'

describe('teachassist planner', () => {
  it('marks unchanged payload as noop', () => {
    const mapped = [{ entity_type: 'attendance' as const, entity_key: 's1:2026-02-12', payload: { status: 'present' } }]
    const first = planOperations(mapped, new Map())
    const hashes = new Map([[`attendance:s1:2026-02-12`, first[0].payload_hash]])

    const next = planOperations(mapped, hashes)
    expect(next[0].action).toBe('noop')
  })

  it('marks changed payload as upsert', () => {
    const mapped = [{ entity_type: 'attendance' as const, entity_key: 's1:2026-02-12', payload: { status: 'absent' } }]
    const hashes = new Map([[`attendance:s1:2026-02-12`, 'different-hash']])

    const planned = planOperations(mapped, hashes)
    expect(planned[0].action).toBe('upsert')
  })
})
