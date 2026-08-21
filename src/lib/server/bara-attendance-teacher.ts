import { z } from 'zod'

const localTeacherSchema = z.object({
  email: z.string().email(),
  role: z.literal('teacher'),
  workos_user_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
}).strict()

export interface VerifiedPikaAttendanceTeacher {
  workosSubject: string
  displayName: string
}

export class TeacherAttendanceIdentityError extends Error {
  constructor(readonly code: 'identity_not_linked' | 'upstream_unavailable') {
    super(code)
    this.name = 'TeacherAttendanceIdentityError'
  }
}

function displayName(user: { firstName?: string | null; lastName?: string | null }) {
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 200)
  return name || 'Pika teacher'
}

export async function resolveVerifiedPikaAttendanceTeacher(input: {
  supabase: any
  pikaUser: { id: string; email: string; role: string }
}): Promise<VerifiedPikaAttendanceTeacher> {
  const { withAuth } = await import('@workos-inc/authkit-nextjs')
  const { user: workOSUser } = await withAuth()
  if (!workOSUser || !workOSUser.emailVerified || input.pikaUser.role !== 'teacher') {
    throw new TeacherAttendanceIdentityError('identity_not_linked')
  }

  const { data, error } = await input.supabase
    .from('users')
    .select('email, role, workos_user_id')
    .eq('id', input.pikaUser.id)
    .maybeSingle()
  if (error) throw new TeacherAttendanceIdentityError('upstream_unavailable')

  const localTeacher = localTeacherSchema.safeParse(data)
  if (!localTeacher.success) {
    throw new TeacherAttendanceIdentityError('identity_not_linked')
  }
  const sessionEmail = workOSUser.email.trim().toLowerCase()
  if (
    localTeacher.data.workos_user_id !== workOSUser.id
    || localTeacher.data.email.trim().toLowerCase() !== sessionEmail
    || input.pikaUser.email.trim().toLowerCase() !== sessionEmail
  ) {
    throw new TeacherAttendanceIdentityError('identity_not_linked')
  }

  return {
    workosSubject: workOSUser.id,
    displayName: displayName(workOSUser),
  }
}
