import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postBaraParticipantErasure } from '@/lib/server/bara-attendance-client'
import { verifyV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'
import { PARTICIPANT_ERASURE_PATH, type ParticipantErasureRequest } from '@/vendor/attendance-contract/participant-erasure'
const request: ParticipantErasureRequest = { schema_version: 1, message_type: 'participant.erase', action: 'begin', installation_ref: 'installation_one', roster_ref: 'roster_one', participant_ref: 'participant_generation_one', operation_ref: `erase_participant_${'a'.repeat(32)}`, actor_principal_ref: 'principal_owner' }
const receipt = { schema_version: 1, ok: true, installation_ref: request.installation_ref, roster_ref: request.roster_ref, participant_ref: request.participant_ref, operation_ref: request.operation_ref, state: 'deleted', absence_verified: true, deleted_count: 7 }
const secret = 'synthetic-only-participant-signing-secret-123456'
beforeEach(() => {
  vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://bara.example.test')
  vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', request.installation_ref)
  vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', secret)
  vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
  vi.stubEnv('PIKA_BARA_PARTICIPANT_ERASURE_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())
describe('Bara participant cleanup transport', () => {
  it('is disabled without its own exact gate', async () => {
    vi.stubEnv('PIKA_BARA_PARTICIPANT_ERASURE_ENABLED', '')
    const fetcher = vi.fn()
    await expect(postBaraParticipantErasure(request, { fetcher })).rejects.toMatchObject({ code: 'disabled' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['begin', 'tick', 'status'] as const)('signs exact %s scope with the attendance credential', async action => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(`https://bara.example.test${PARTICIPANT_ERASURE_PATH}`)
      expect(JSON.parse(String(init?.body))).toEqual({ ...request, action })
      const headers = new Headers(init?.headers)
      expect(await verifyV1RequestSignature({ secret, method: 'POST', path: PARTICIPANT_ERASURE_PATH, timestamp: headers.get('X-Attendance-Timestamp')!, nonce: headers.get('X-Attendance-Nonce')!, body: String(init?.body) }, headers.get('X-Attendance-Signature'))).toBe(true)
      return Response.json(receipt)
    })
    expect(await postBaraParticipantErasure({ ...request, action }, { fetcher })).toEqual(receipt)
  })
  it.each(['installation_ref', 'roster_ref', 'participant_ref', 'operation_ref'])('rejects foreign %s', async key => {
    await expect(postBaraParticipantErasure(request, { fetcher: vi.fn(async () => Response.json({ ...receipt, [key]: 'other' })) })).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it.each([{ schema_version: 2 }, { ok: false }, { absence_verified: false }, { deleted_count: -1 }, { deleted_count: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }])('rejects malformed receipt %j', async patch => {
    await expect(postBaraParticipantErasure(request, { fetcher: vi.fn(async () => Response.json({ ...receipt, ...patch })) })).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it.each(['deleting', 'blocked'])('preserves %s without absence evidence', async state => {
    expect(await postBaraParticipantErasure(request, { fetcher: vi.fn(async () => Response.json({ ...receipt, state, absence_verified: false })) })).toMatchObject({ state, absence_verified: false })
  })
  it.each([202, 404, 409, 503])('does not accept status %i as completion', async status => {
    await expect(postBaraParticipantErasure(request, { fetcher: vi.fn(async () => Response.json(receipt, { status })) })).rejects.toThrow()
  })
  it('retries an uncertain begin with identical references and a fresh nonce', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('secret provider payload')).mockResolvedValueOnce(Response.json(receipt))
    await expect(postBaraParticipantErasure(request, { fetcher })).rejects.toMatchObject({ code: 'network_error', retryable: true, message: 'Participant cleanup could not be verified' })
    await postBaraParticipantErasure(request, { fetcher })
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body)
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('X-Attendance-Nonce')).not.toBe(new Headers(fetcher.mock.calls[1][1]?.headers).get('X-Attendance-Nonce'))
  })
})
