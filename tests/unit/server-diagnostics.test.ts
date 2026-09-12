import { afterEach, describe, expect, it, vi } from 'vitest'
import { logServerError } from '@/lib/server/diagnostics'

describe('content-free server diagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    new Error('Élodie secret journal answer token=secret', { cause: { email: 'student@example.invalid' } }),
    { code: '23505', message: 'private answer', details: 'private name', hint: 'secret' },
    { name: 'private name', code: 'private code', stack: 'private stack' },
    'private response body',
    null,
  ])('emits only the allowlisted shape without serializing the error', (error) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const id = logServerError('api.unexpected', error)
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    expect(spy).toHaveBeenCalledWith('[pika-diagnostic]', {
      event: 'api.unexpected', category: error && typeof error === 'object' && 'code' in error && error.code === '23505' ? 'database' : 'unexpected', diagnosticId: id,
    })
  })

  it('rejects dynamic event labels and never invokes error getters or serializers', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const trap = vi.fn(() => { throw new Error('private') })
    const error = Object.defineProperties({ toJSON: trap, toString: trap }, {
      name: { get: trap }, code: { get: trap }, message: { get: trap },
    })
    Object.assign(error, { self: error })
    logServerError('student@example.invalid' as never, error)
    expect(trap).not.toHaveBeenCalled()
    expect(spy.mock.calls[0][1]).toMatchObject({ event: 'unknown', category: 'unexpected' })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('private')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('student@')
  })

  it('contains hostile proxies and classifies fixed timeout identifiers', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('private') } })
    expect(() => logServerError('auth.email', proxy)).not.toThrow()
    logServerError('auth.email', { name: 'AbortError', message: 'private' })
    expect(spy.mock.calls[1][1]).toMatchObject({ category: 'timeout' })
  })
})
