import { beforeEach, describe, expect, it, vi } from 'vitest'

const { withAuth } = vi.hoisted(() => ({ withAuth: vi.fn() }))

vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth }))

import {
  resolveVerifiedPikaAttendanceTeacher,
  resolveVerifiedPikaAttendanceOwner,
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

  it('verifies an admitted owner identity without granting a global teacher role', async () => {
    withAuth.mockResolvedValue({ user: {
      id: 'user_owner', email: 'Owner@Example.com', emailVerified: true,
      firstName: 'Classroom', lastName: 'Owner',
    } })
    const { supabase, eq } = supabaseRow({
      email: 'owner@example.com', role: 'student', workos_user_id: 'user_owner',
    })
    const pikaUser = { id: 'a0000000-0000-4000-8000-000000000001', email: 'owner@example.com', role: 'student' }
    await expect(resolveVerifiedPikaAttendanceOwner({ supabase, pikaUser })).resolves.toEqual({
      workosSubject: 'user_owner', displayName: 'Classroom Owner',
    })
    expect(eq).toHaveBeenCalledWith('id', pikaUser.id)
    await expect(resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser })).rejects.toEqual(
      new TeacherAttendanceIdentityError('identity_not_linked'),
    )
  })

  it.each([
    ['unverified email', false, 'user_owner', 'owner@example.com', 'student', 'owner@example.com'],
    ['different subject', true, 'user_other', 'owner@example.com', 'student', 'owner@example.com'],
    ['different database email', true, 'user_owner', 'other@example.com', 'student', 'owner@example.com'],
    ['stale account label', true, 'user_owner', 'owner@example.com', 'teacher', 'owner@example.com'],
    ['different session email', true, 'user_owner', 'owner@example.com', 'student', 'other@example.com'],
  ])('refuses an owner with %s', async (_label, emailVerified, subject, email, role, sessionEmail) => {
    withAuth.mockResolvedValue({ user: { id: subject, email: 'owner@example.com', emailVerified } })
    const { supabase } = supabaseRow({ email, role, workos_user_id: 'user_owner' })
    await expect(resolveVerifiedPikaAttendanceOwner({ supabase, pikaUser: {
      id: 'a0000000-0000-4000-8000-000000000001', email: sessionEmail, role: 'student',
    } })).rejects.toEqual(new TeacherAttendanceIdentityError('identity_not_linked'))
  })

  it('rejects an invalid local owner UUID before consulting the provider', async () => {
    const { supabase } = supabaseRow(null)
    await expect(resolveVerifiedPikaAttendanceOwner({ supabase, pikaUser: {
      id: 'not-a-local-uuid', email: 'owner@example.com', role: 'student',
    } })).rejects.toEqual(new TeacherAttendanceIdentityError('identity_not_linked'))
    expect(withAuth).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
