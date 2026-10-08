import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  contextualTestPublicationIdentitySchema, contextualTestPublicationRequestSchema,
  readContextualTestPublicationBody, TEST_PUBLICATION_BODY_BYTES,
} from '@/lib/validations/contextual-test-publication'

const body = { status: 'closed', draft_version: 7 }
const read = (text: string, headers?: HeadersInit) => readContextualTestPublicationBody(new Request('http://localhost', { method: 'POST', body: text, headers }))

describe('bounded closed Test publication material', () => {
  afterEach(() => vi.useRealTimers())
  it.each([1, 7, 2147483647])('accepts native version %s', draft_version => {
    expect(contextualTestPublicationRequestSchema.parse({ status: 'closed', draft_version })).toEqual({ status: 'closed', draft_version })
  })
  it.each([null, [], {}, { ...body, status: 'active' }, { ...body, actor_id: 'forged' }, { ...body, classroom_id: 'forged' },
    { ...body, title: 'edit' }, { ...body, documents: [] }, { ...body, deadline: 1 }, { ...body, source_sha256: 'forged' },
    ...[0, -1, 1.5, 2147483648, '7', true, null, NaN, Infinity].map(draft_version => ({ ...body, draft_version }))])('rejects malformed/expanded body %#', value => {
    expect(contextualTestPublicationRequestSchema.safeParse(value).success).toBe(false)
  })
  it('canonicalizes only server identity UUIDs', () => {
    const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    expect(contextualTestPublicationIdentitySchema.parse({ actorId: id, testId: id })).toEqual({ actorId: id.toLowerCase(), testId: id.toLowerCase() })
    expect(contextualTestPublicationIdentitySchema.safeParse({ actorId: 'bad', testId: id }).success).toBe(false)
  })
  it('reads actual UTF8 bytes once', async () => {
    const text = JSON.stringify(body)
    expect(await read(text)).toEqual({ body, bytes: Buffer.byteLength(text) })
  })
  it.each(['{"status":"closed","status":"active","draft_version":7}',
    '{"status":"closed","\\u0073tatus":"closed","draft_version":7}',
    '{"status":"closed","draft_version":7,"extra":{"x":1,"x":2}}',
    '{"status":"closed","draft_version":7,"extra":[{"x":1,"\\u0078":2}]}',
    '{"status":"closed","draft_version":7,"extra":{"a\\\"b":1,"a\\u0022b":2}}',
    '{"status":"closed","draft_version":7,"extra":{"__proto__":1,"__proto__":2}}'])('rejects duplicate decoded keys at every depth %#', async text => {
    await expect(read(text)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('does not misidentify punctuation/escapes inside values as keys', async () => {
    const value = { ...body, extra: '"status":false, { [ \\ \u0000', nested: [{ x: 1 }, { x: 2 }] }
    expect((await read(JSON.stringify(value))).body).toEqual(value)
  })
  it.each(['', '{', 'null', '[]', '1', '"text"', '{"status":}', '{"x":true,}', '{"x":[1,]}', '{"x":"\\q"}', '{"x":NaN}', '{} {}'])('rejects malformed or nonobject input %#', async text => {
    await expect(read(text)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('bounds nested scanning rather than risking stack exhaustion', async () => {
    await expect(read('{"x":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('accepts exactly16KiB raw JSON including whitespace; rejects one extra byte', async () => {
    const text = JSON.stringify(body).padEnd(TEST_PUBLICATION_BODY_BYTES, ' ')
    expect(await read(text)).toEqual({ body, bytes: TEST_PUBLICATION_BODY_BYTES })
    await expect(read(text + ' ')).rejects.toMatchObject({ statusCode: 400 })
  })
  it.each(['bad', '-1', '1.0', '16385', 'Infinity'])('rejects advertised invalid/oversized length %s', async length => {
    await expect(read(JSON.stringify(body), { 'content-length': length })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('bounds bytes despite lying advertised length and multibyte text', async () => {
    await expect(read(JSON.stringify({ extra: 'é'.repeat(8192) }), { 'content-length': '1' })).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects fatal UTF8 instead of replacement decoding', async () => {
    await expect(readContextualTestPublicationBody(new Request('http://localhost', { method: 'POST', body: new Uint8Array([255]) }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('handles fragmented UTF8/string escapes', async () => {
    const value = { ...body, extra: 'é\\"' }; const bytes = new TextEncoder().encode(JSON.stringify(value))
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } })
    expect((await readContextualTestPublicationBody(new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' }))).body).toEqual(value)
  })
  it('bounds reads as well as bytes for an empty-chunk stream', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i <= TEST_PUBLICATION_BODY_BYTES; i++) controller.enqueue(new Uint8Array())
      controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close()
    } })
    await expect(readContextualTestPublicationBody(new Request('http://localhost', { method: 'POST', body: stream, duplex: 'half' }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('cancels unread material after invalid length without awaiting a hostile cancel', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', headers: { 'content-length': 'bad' } })
    await expect(readContextualTestPublicationBody(request)).rejects.toMatchObject({ statusCode: 400 }); expect(cancel).toHaveBeenCalledOnce()
  })
  it('cancels stalled reader promptly and releases lock at the shared deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}))
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half' })
    const check = expect(readContextualTestPublicationBody(request, Date.now() + 50)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(50); await check
    expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts reader on request cancellation and removes listeners', async () => {
    const controller = new AbortController(); const cancel = vi.fn()
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream<Uint8Array>({ cancel }), duplex: 'half', signal: controller.signal })
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    const check = expect(readContextualTestPublicationBody(request)).rejects.toMatchObject({ statusCode: 503 })
    controller.abort(); await check
    expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
  it.each([0, NaN, Infinity])('rejects nonfinite/expired deadline %s before reading', async deadline => {
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) })
    await expect(readContextualTestPublicationBody(request, deadline)).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects missing body', async () => {
    await expect(readContextualTestPublicationBody(new Request('http://localhost', { method: 'POST' }))).rejects.toMatchObject({ statusCode: 400 })
  })
  it('rejects an already-owned body without stealing its reader', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) })
    const reader = request.body!.getReader()
    await expect(readContextualTestPublicationBody(request)).rejects.toMatchObject({ statusCode: 400 })
    expect(request.body?.locked).toBe(true); await reader.cancel(); reader.releaseLock()
  })
})
