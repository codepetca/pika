import { describe, expect, it } from 'vitest'
import { OptimisticAttendanceQueue } from '@/lib/optimistic-attendance'

type View = Record<string, string>
function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  let rendered: View = {}
  const queue = new OptimisticAttendanceQueue<View, string>({
    project: (view, ids, status) => ({ ...view, ...Object.fromEntries(ids.map(id => [id, status])) }),
    matches: (view, id, status) => view[id] === status,
    onChange: (view) => { rendered = view },
  })
  queue.accept({ a: 'present', b: 'present' }, queue.version)
  return { queue, rendered: () => rendered }
}

describe('optimistic attendance queue', () => {
  it('accepts rapid corrections immediately and orders overlapping writes without blocking other students', async () => {
    const { queue, rendered } = setup()
    const first = deferred()
    const calls: string[] = []
    const a = queue.run(['a'], 'absent', async ids => { calls.push('a1'); await first.promise; return ids })
    const correction = queue.run(['a'], 'late', async ids => { calls.push('a2'); return ids })
    const b = queue.run(['b'], 'absent', async ids => { calls.push('b'); return ids })
    expect(rendered()).toEqual({ a: 'late', b: 'absent' })
    await b
    expect(calls).toEqual(['a1', 'b'])
    first.resolve()
    await Promise.all([a, correction])
    expect(calls).toEqual(['a1', 'b', 'a2'])
    expect(queue.pendingStudentIds.size).toBe(0)
  })

  it('rolls back only a failed write and preserves a newer correction and other saved students', async () => {
    const { queue, rendered } = setup()
    const first = deferred()
    const a = queue.run(['a'], 'absent', async () => { await first.promise; return [] })
    const correction = queue.run(['a'], 'late', async ids => ids)
    await queue.run(['b'], 'absent', async ids => ids)
    first.reject(new Error('failed'))
    await expect(a).rejects.toThrow('failed')
    await correction
    expect(rendered()).toEqual({ a: 'late', b: 'absent' })
    await expect(queue.run(['a'], 'present', async () => { throw new Error('failed again') })).rejects.toThrow()
    expect(rendered()).toEqual({ a: 'late', b: 'absent' })
  })

  it('protects committed and queued changes from stale reads and retires confirmed projections', async () => {
    const { queue, rendered } = setup()
    const oldRead = queue.version
    await queue.run(['a'], 'absent', async ids => ids)
    queue.accept({ a: 'present', b: 'late' }, oldRead)
    expect(rendered()).toEqual({ a: 'absent', b: 'late' })
    // A read started before commit cannot retire the overlay even if it happens to match.
    queue.accept({ a: 'absent', b: 'late' }, oldRead)
    expect(queue.hasUnconfirmedMarks).toBe(true)
    queue.accept({ a: 'absent', b: 'late' }, queue.version)
    expect(queue.hasUnconfirmedMarks).toBe(false)
    queue.accept({ a: 'present', b: 'late' }, queue.version)
    expect(rendered().a).toBe('present')
  })

  it('preserves confirmed chunks and rolls back the unsaved portion on a partial failure', async () => {
    const { queue, rendered } = setup()
    await expect(queue.run(['a', 'b'], 'absent', async (_ids, commit) => {
      commit(['a'])
      throw new Error('partial failure')
    })).rejects.toThrow('partial failure')
    expect(rendered()).toEqual({ a: 'absent', b: 'present' })
  })

  it('cancels queued writes on disposal and ignores responses from the old scope', async () => {
    const { queue, rendered } = setup()
    const first = deferred()
    let writes = 0
    const a = queue.run(['a'], 'absent', async ids => { writes++; await first.promise; return ids })
    const b = queue.run(['a'], 'late', async ids => { writes++; return ids })
    await Promise.resolve()
    await Promise.resolve()
    queue.dispose()
    first.resolve()
    await Promise.all([a, b])
    expect(writes).toBe(1)
    expect(rendered().a).toBe('late')
  })
})
