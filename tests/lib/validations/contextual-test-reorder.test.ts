import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  contextualTestReorderRequestSchema, contextualTestReorderIdentitySchema,
  contextualTestReorderRpcEnvelopeSchema, readContextualTestReorderBody, TEST_REORDER_BODY_BYTES,
} from '@/lib/validations/contextual-test-reorder'

const classroomId = '22222222-2222-4222-8222-222222222222'
const testId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
const body = { classroom_id: classroomId, test_ids: [testId.toLowerCase()] }
const read = (text: string, headers?: HeadersInit) => readContextualTestReorderBody(new Request('http://localhost', { method: 'POST', body: text, headers }))
const ids = (length: number) => Array.from({ length }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`)

describe('bounded atomic Test reorder material', () => {
  afterEach(() => vi.useRealTimers())
  it('canonicalizes UUID inputs, including the actor identity', () => {
    expect(contextualTestReorderRequestSchema.parse({ classroom_id: testId, test_ids: [testId] })).toEqual({ classroom_id: testId.toLowerCase(), test_ids: [testId.toLowerCase()] })
    expect(contextualTestReorderIdentitySchema.parse({ actorId: testId })).toEqual({ actorId: testId.toLowerCase() })
  })
  it.each([0, 1, 999, 1000])('accepts complete membership of size %i', length => {
    expect(contextualTestReorderRequestSchema.parse({ classroom_id: classroomId, test_ids: ids(length) }).test_ids).toHaveLength(length)
  })
  it.each([null, [], {}, { ...body, classroom_id: 'bad' }, { ...body, test_ids: null }, { ...body, test_ids: [null] },
    { ...body, test_ids: ['bad'] }, { ...body, actor_id: testId }, { ...body, deadline: 1 }, { ...body, positions: [0] },
    { ...body, test_ids: [testId, testId.toLowerCase()] }, { ...body, test_ids: ids(1001) }, { ...body, test_ids: ids(10000) }])('rejects invalid or expanded request %#', value => {
    expect(contextualTestReorderRequestSchema.safeParse(value).success).toBe(false)
  })
  it('reads actual UTF8 bytes once', async () => {
    const text = JSON.stringify(body)
    expect(await read(text)).toEqual({ body, bytes: Buffer.byteLength(text) })
  })
  it.each([{ data: null }, { error: null }, { data: null, error: null, extra: true },
    { data: null, error: { code: 'PT403', message: 'Forbidden', private: true } }])('rejects malformed/expanded RPC envelope %#', value => {
    expect(contextualTestReorderRpcEnvelopeSchema.safeParse(value).success).toBe(false)
  })
  it.each(['{"classroom_id":"x","classroom_id":"y"}', '{"test_ids":[],"test_\\u0069ds":[]}',
    '{"extra":{"x":1,"x":2}}', '{"extra":[{"x":1,"\\u0078":2}]}',
    '{"extra":{"a\\\"b":1,"a\\u0022b":2}}', '{"extra":{"__proto__":1,"__proto__":2}}'])('rejects duplicate decoded keys at every depth %#', async text => {
    await expect(read(text)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('keeps keys in sibling objects and punctuation in values independent', async () => {
    const value = { ...body, extra: '"test_ids":false, { [ \\ \u0000', nested: [{ x: 1 }, { x: 2 }] }
    expect((await read(JSON.stringify(value))).body).toEqual(value)
  })
  it.each(['', '{', 'null', '[]', '1', '"text"', '{"x":}', '{"x":true,}', '{"x":[1,]}', '{"x":"\\q"}', '{"x":NaN}', '{} {}', '{"x":"unterminated', '{"x":1,2:3}'])('rejects malformed or nonobject JSON %#', async text => {
    await expect(read(text)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('bounds recursive JSON scanning', async () => {
    await expect(read('{"x":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('accepts exactly512KiB actual bytes and rejects one additional byte', async () => {
    const text = JSON.stringify(body).padEnd(TEST_REORDER_BODY_BYTES, ' ')
    expect((await read(text)).bytes).toBe(TEST_REORDER_BODY_BYTES)
    await expect(read(text + ' ')).rejects.toMatchObject({ statusCode: 400 })
  })
  it.each(['bad', '-1', '1.0', String(512 * 1024 + 1), 'Infinity'])('rejects invalid/oversized advertised length %s', async length => {
    await expect(read(JSON.stringify(body), { 'content-length': length })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('counts multibyte UTF8 despite an understated length', async () => {
    await expect(read(JSON.stringify({ extra: 'é'.repeat(256 * 1024) }), { 'content-length': '1' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects malformed UTF8', async () => {
    await expect(readContextualTestReorderBody(new Request('http://localhost', { method: 'POST', body: new Uint8Array([255]) }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('handles fragmented UTF8 and escaped strings', async () => {
    const value = { ...body, extra: 'é\\"' }; const bytes = new TextEncoder().encode(JSON.stringify(value))
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close() } })
    expect((await readContextualTestReorderBody(new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' }))).body).toEqual(value)
  })
  it('bounds empty-chunk streams independently of byte counts', async () => {
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array()) } })
    await expect(readContextualTestReorderBody(new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('cancels invalid advertised length without awaiting hostile cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', headers: { 'content-length': 'bad' } })
    await expect(readContextualTestReorderBody(request)).rejects.toMatchObject({ statusCode: 400 }); expect(cancel).toHaveBeenCalledOnce()
  })
  it('bounds a stalled reader under the original deadline and releases its lock', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}))
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half' })
    const pending = expect(readContextualTestReorderBody(request, Date.now() + 50)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(50); await pending
    expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0)
  })
  it('honors caller cancellation and removes its listener', async () => {
    const controller = new AbortController(); const cancel = vi.fn()
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', signal: controller.signal })
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    const pending = expect(readContextualTestReorderBody(request)).rejects.toMatchObject({ statusCode: 503 })
    controller.abort(); await pending
    expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
  it.each([0, NaN, Infinity])('rejects expired or nonfinite deadline %s', async deadline => {
    await expect(readContextualTestReorderBody(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }), deadline)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects a missing body', async () => {
    await expect(readContextualTestReorderBody(new Request('http://localhost', { method: 'POST' }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects a locked body without stealing another reader', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }); const reader = request.body!.getReader()
    await expect(readContextualTestReorderBody(request)).rejects.toMatchObject({ statusCode: 400 })
    expect(request.body?.locked).toBe(true); await reader.cancel(); reader.releaseLock()
  })
  it('rejects an already-consumed body', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }); await request.text()
    await expect(readContextualTestReorderBody(request)).rejects.toMatchObject({ statusCode: 400 })
  })
})
