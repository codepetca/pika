import { describe, expect, it, vi } from 'vitest'
import { authoringImageReservationSchema, validateAuthoringImageHeader, authoringImageUrl, isRetainedAuthoringImage } from '@/lib/server/authoring-images'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const classroomId = '11111111-1111-4111-8111-111111111111'
describe('teacher authoring image boundary', () => {
  const reservation = { classroom_id: classroomId, file_name: 'diagram.png', content_type: 'image/png', byte_size: 2 * 1024 * 1024 }
  it('accepts exactly 2 MB and rejects larger files before storage reservation', () => {
    expect(authoringImageReservationSchema.parse(reservation).byte_size).toBe(2097152)
    expect(authoringImageReservationSchema.safeParse({ ...reservation, byte_size: 2097153 }).success).toBe(false)
    expect(authoringImageReservationSchema.safeParse({ ...reservation, byte_size: 0 }).success).toBe(false)
  })
  it('does not reserve SVG or disguised image bytes', () => {
    expect(authoringImageReservationSchema.safeParse({ ...reservation, content_type: 'image/svg+xml' }).success).toBe(false)
    expect(() => validateAuthoringImageHeader('image/png', new TextEncoder().encode('<svg></svg>'))).toThrow()
    expect(() => validateAuthoringImageHeader('image/gif', new TextEncoder().encode('<script>'))).toThrow()
    expect(() => validateAuthoringImageHeader('image/webp', new TextEncoder().encode('not an image'))).toThrow()
  })
  it('accepts raster GIF signatures, rejects zero dimensions', () => {
    const bytes = new Uint8Array([71,73,70,56,57,97,10,0,10,0,0,0,0])
    expect(() => validateAuthoringImageHeader('image/gif', bytes)).not.toThrow()
    bytes[6] = 0
    expect(() => validateAuthoringImageHeader('image/gif', bytes)).toThrow()
  })
  it('uses a durable protected URL instead of a signed URL in Markdown', () => {
    expect(authoringImageUrl(classroomId)).toBe(`/api/storage/authoring-images?object_id=${classroomId}`)
  })
  it('previews only previously attached, unclaimed images inside the undo window', () => {
    const now = new Date('2026-10-22T12:00:00Z')
    const retained = { purpose: 'teacher_authoring_image', status: 'cleanup_pending', cleanup_reason_code: 'authoring_image_reference_removed',
      attempt_count: 0, next_attempt_at: '2026-10-22T13:00:00Z', lease_token: null, lease_expires_at: null,
      verified_at: '2026-10-22T11:00:00Z', ready_at: '2026-10-22T11:00:01Z' }
    expect(isRetainedAuthoringImage(retained, now)).toBe(true)
    for (const change of [{ purpose: 'teacher_test_material' }, { status: 'cleanup_processing' }, { cleanup_reason_code: 'reservation_expired' },
      { attempt_count: 1 }, { next_attempt_at: now.toISOString() }, { next_attempt_at: 'invalid' }, { lease_token: classroomId },
      { lease_expires_at: '2026-10-22T13:00:00Z' }, { verified_at: null }, { ready_at: null }]) {
      expect(isRetainedAuthoringImage({ ...retained, ...change }, now)).toBe(false)
    }
  })
})
