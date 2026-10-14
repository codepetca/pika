import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { assertContextualTestReferenceObjects, createContextualTestReferenceProof, readContextualTestReference } from '../../e2e/helpers/contextual-test-workflow'

const testId = '50000000-0000-4000-8000-000000000001', documentId = '50000000-0000-4000-8000-000000000002'
const objectId = '50000000-0000-4000-8000-000000000003', classroom = '50000000-0000-4000-8000-000000000004'
const path = `/api/teacher/tests/${testId}/documents/${documentId}/file`
const storagePath = `classrooms/${classroom}/tests/${testId}/documents/${documentId}/${objectId}.pdf`
const signedUrl = `http://127.0.0.1:54331/storage/v1/object/sign/test-documents/${storagePath}?token=opaque-private-value`
const input = () => ({ path, storagePath, apiOrigin: 'http://127.0.0.1:54331', expectedBytes: 4, deadline: Date.now() + 30000 })
// Execute the actual compiled function's serialized browser path: no module
// helpers or Node body reader can accidentally satisfy this CPU regression.
const browserRead = (value: ReturnType<typeof input>): Promise<number[]> => runInNewContext(`(${readContextualTestReference.toString()})(input)`, {
  input: value, fetch, location, Date, AbortController, setTimeout, clearTimeout, Uint8Array, Promise, Number, Error, Array, URL,
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function fakeFetch(headersMs: number, chunks: Array<{ delay: number; bytes?: number[] }>, target = signedUrl) {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  const reads = vi.fn(), cancel = vi.fn(async () => {}), releaseLock = vi.fn()
  let signal: AbortSignal, acquired = 0
  const fetch = vi.fn(async (_path: string, init: RequestInit) => {
    signal = init.signal!; expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'follow' })
    await new Promise(resolve => setTimeout(resolve, headersMs))
    return { ok: true, status: 200, redirected: true, url: target, body: { getReader() {
      acquired++
      return { read: reads.mockImplementation(async () => {
        const chunk = chunks.shift()
        if (!chunk) return new Promise(() => {})
        await new Promise(resolve => setTimeout(resolve, chunk.delay))
        return chunk.bytes ? { done: false, value: new Uint8Array(chunk.bytes) } : { done: true }
      }), cancel, releaseLock }
    } } }
  })
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('location', { origin: 'http://localhost:3117' })
  return { fetch, reads, cancel, releaseLock, signal: () => signal, acquired: () => acquired }
}
describe('actual browser reference read function, CPU fake network only', () => {
  it('reads the same-cookie original response body exactly once to complete exact bytes', async () => {
    const f = fakeFetch(5, [{ delay: 5, bytes: [1,2] }, { delay: 5, bytes: [3,4] }, { delay: 5 }])
    const pending = browserRead(input()); await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toEqual([1,2,3,4]); expect(f.fetch).toHaveBeenCalledOnce(); expect(f.acquired()).toBe(1)
    expect(f.releaseLock).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('accepts the exact 32KiB ceiling and rejects an already-expired deadline before fetch', async () => {
    const expected = Array(32768).fill(37), f = fakeFetch(0, [{ delay: 0, bytes: expected }, { delay: 0 }])
    const pending = browserRead({ ...input(), expectedBytes: expected.length }); await vi.advanceTimersByTimeAsync(10)
    await expect(pending).resolves.toEqual(expected); expect(f.acquired()).toBe(1)
    await expect(browserRead({ ...input(), deadline: Date.now() })).rejects.toThrow()
    expect(f.fetch).toHaveBeenCalledOnce()
  })
  for (const mode of ['headers', 'stalled', 'trickle', 'settles-at-deadline'] as const) it(`fails by the original operation deadline: ${mode}`, async () => {
    const f = fakeFetch(mode === 'headers' ? 40000 : 0, mode === 'trickle' ? [{ delay: 15000, bytes: [1] }, { delay: 15000, bytes: [2] }] : mode === 'settles-at-deadline' ? [{ delay: 29999, bytes: [1,2,3,4] }, { delay: 1 }] : [])
    const pending = browserRead(input()), assertion = expect(pending).rejects.toThrow('Reference read failed')
    await vi.advanceTimersByTimeAsync(30000); await assertion
    expect(f.signal().aborted).toBe(true); expect(f.fetch).toHaveBeenCalledOnce()
    if (mode !== 'headers') expect(f.cancel).toHaveBeenCalledOnce()
  })
  it('uses a shorter original run cutoff without renewing the operation clock', async () => {
    const f = fakeFetch(100, [{ delay: 10000, bytes: [1,2,3,4] }])
    const pending = browserRead({ ...input(), deadline: 1500 }), assertion = expect(pending).rejects.toThrow('Reference read failed')
    await vi.advanceTimersByTimeAsync(500); await assertion; expect(f.signal().aborted).toBe(true)
  })
  it('rejects overflow immediately and cancels the single body reader', async () => {
    const f = fakeFetch(0, [{ delay: 0, bytes: [1,2,3,4,5] }])
    const pending = browserRead(input()), assertion = expect(pending).rejects.toThrow('Reference read failed')
    await vi.advanceTimersByTimeAsync(10); await assertion; expect(f.cancel).toHaveBeenCalledOnce(); expect(f.signal().aborted).toBe(true)
  })
  it('rejects short bytes, missing signed redirect metadata and invalid size/path without a second body acquisition', async () => {
    const f = fakeFetch(0, [{ delay: 0, bytes: [1] }, { delay: 0 }])
    const pending = browserRead(input()), assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10); await assertion; expect(f.acquired()).toBe(1)
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, redirected: false, url: `http://localhost:3117${path}` }))
    await expect(browserRead(input())).rejects.toThrow()
    await expect(browserRead({ ...input(), expectedBytes: 32769 })).rejects.toThrow()
    await expect(browserRead({ ...input(), path: 'https://foreign.invalid/file' })).rejects.toThrow()
  })
  for (const target of [signedUrl.replace('127.0.0.1:54331', 'foreign.invalid'), signedUrl.replace(objectId, testId),
    signedUrl + '#fragment', signedUrl + '&extra=1', signedUrl + '&token=duplicate', signedUrl.replace('http://', 'http://user:password@')]) {
    it('rejects a foreign origin/path, credentials, hash or extra query without returning the signed token', async () => {
      const f = fakeFetch(0, [], target), pending = browserRead(input())
      const assertion = expect(pending).rejects.toThrow('Reference read failed')
      await vi.advanceTimersByTimeAsync(1); await assertion
      expect(f.acquired()).toBe(0); expect(f.signal().aborted).toBe(true)
    })
  }
})

describe('actual PDF upload/download/object identity proof', () => {
  const document = () => ({ id: documentId, source: 'upload', title: 'Uploaded reference', managed_object_id: objectId,
    storage_path: `classrooms/${classroom}/tests/${testId}/documents/${documentId}/${objectId}.pdf` })
  const bytes = Buffer.from('%PDF-fixture')
  const proof = () => createContextualTestReferenceProof(testId, classroom, document(), bytes, Array.from(bytes))
  const object = () => ({ id: objectId, resource_id: testId, purpose: 'teacher_test_material', status: 'ready', byte_size: bytes.length, content_sha256: null })
  it('computes its own SHA from exact original uploaded/downloaded bytes and permits a genuine null DB digest', () => {
    const actual = proof(); expect(actual.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(Object.isFrozen(actual)).toBe(true); expect(() => assertContextualTestReferenceObjects([object()], [actual])).not.toThrow()
    expect(() => assertContextualTestReferenceObjects([{ ...object(), content_sha256: actual.sha256 }], [actual])).not.toThrow()
  })
  it('rejects mismatched downloaded bytes, excessive size and wrong document/object/path identity', () => {
    expect(() => createContextualTestReferenceProof(testId, classroom, document(), bytes, Array.from(Buffer.from('%PDF-wrong!!')))).toThrow()
    expect(() => createContextualTestReferenceProof(testId, classroom, document(), Buffer.alloc(32769), Array(32769).fill(0))).toThrow()
    expect(() => createContextualTestReferenceProof(testId, classroom, document(), bytes, [...Array.from(bytes).slice(0, -1), 256])).toThrow()
    for (const changed of [{ id: testId }, { managed_object_id: testId }, { storage_path: 'foreign' }]) {
      expect(() => createContextualTestReferenceProof(testId, classroom, { ...document(), ...changed }, bytes, Array.from(bytes))).toThrow()
    }
  })
  it('rejects unrelated, duplicate, non-ready, wrong-size objects and non-null digest disagreement', () => {
    for (const changed of [{ id: testId }, { resource_id: documentId }, { purpose: 'other' }, { status: 'verified' }, { byte_size: 1 }, { content_sha256: 'b'.repeat(64) }]) {
      expect(() => assertContextualTestReferenceObjects([{ ...object(), ...changed }], [proof()])).toThrow()
    }
    expect(() => assertContextualTestReferenceObjects([object(), object()], [proof(), proof()])).toThrow()
  })
})
