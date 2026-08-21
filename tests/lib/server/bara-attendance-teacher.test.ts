import { beforeEach, describe, expect, it, vi } from 'vitest'

const { withAuth } = vi.hoisted(() => ({ withAuth: vi.fn() }))

vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth }))

import {
  resolveVerifiedPikaAttendanceTeacher,
  TeacherAttendanceIdentityError,
} from '@/lib/server/bara-attendance-teacher'

function supabaseRow(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  return { supabase: { from: vi.fn(() => ({ select })) }, select, eq, maybeSingle }
}

describe('verified Pika attendance teacher identity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('derives the subject and display name only from an exact WorkOS/Pika link', async () => {
    withAuth.mockResolvedValue({
      user: {
        id: 'user_teacher',
        email: 'Teacher@Example.com',
        emailVerified: true,
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    })
    const { supabase } = supabaseRow({
      email: 'teacher@example.com', role: 'teacher', workos_user_id: 'user_teacher',
    })

    await expect(resolveVerifiedPikaAttendanceTeacher({
      supabase,
      pikaUser: { id: 'teacher-one', email: 'teacher@example.com', role: 'teacher' },
    })).resolves.toEqual({ workosSubject: 'user_teacher', displayName: 'Ada Lovelace' })
  })

  it.each([
    ['different subject', 'user_other', 'teacher@example.com'],
    ['different email', 'user_teacher', 'other@example.com'],
  ])('fails closed for a %s', async (_label, subject, email) => {
    withAuth.mockResolvedValue({
      user: {
        id: subject,
        email: 'teacher@example.com',
        emailVerified: true,
        firstName: null,
        lastName: null,
      },
    })
    const { supabase } = supabaseRow({
      email, role: 'teacher', workos_user_id: 'user_teacher',
    })

    await expect(resolveVerifiedPikaAttendanceTeacher({
      supabase,
      pikaUser: { id: 'teacher-one', email: 'teacher@example.com', role: 'teacher' },
    })).rejects.toEqual(new TeacherAttendanceIdentityError('identity_not_linked'))
  })
})
