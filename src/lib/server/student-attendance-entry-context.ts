import { z } from 'zod'
import type { getServiceRoleClient } from '@/lib/supabase'
import { openAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'
import { resolveClassroomAttendanceQrId } from '@/lib/server/classroom-attendance-qr'
import { resolveAttendanceMembershipScanGeneration, resolveAttendanceScanGeneration, sameAttendanceScanGeneration } from '@/lib/server/attendance-generation'
import { resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'

const enrolledClassroomSchema = z.object({
  classrooms: z.object({ title: z.string() }),
})

/** Optional display context; a failed lookup must not prevent the check-in request. */
export async function loadStudentAttendanceEntryClassroomName(input: {
  supabase: ReturnType<typeof getServiceRoleClient>
  pikaUser: { id: string; role: string }
  entryToken: string
  mode?: 'occurrence' | 'classroom'
}): Promise<string | undefined> {
  try {
    const admitted = resolveClassroomExperienceAdmission(input.pikaUser).status === 'admitted'
    if (!admitted && input.pikaUser.role !== 'student') return undefined
    const resolveGeneration = admitted ? resolveAttendanceMembershipScanGeneration : resolveAttendanceScanGeneration
    const classroomId = input.mode === 'classroom'
      ? await resolveClassroomAttendanceQrId(input.supabase, input.entryToken)
      // Authenticate expired tokens only for the label on a closed result.
      // The attendance command still enforces the token's actual expiry.
      : openAttendanceEntryToken(input.entryToken, { now: 0 }).classroomId
    const membership = { supabase: input.supabase, classroomId, studentId: input.pikaUser.id }
    const generation = await resolveGeneration(membership)
    if (generation.status === 'forbidden') return undefined
    const { data, error } = await input.supabase
      .from('classroom_enrollments')
      .select('classrooms(title)')
      .eq('classroom_id', classroomId)
      .eq('student_id', input.pikaUser.id)
      .maybeSingle()
    const parsed = enrolledClassroomSchema.safeParse(data)
    if (error || !parsed.success) return undefined
    if (!sameAttendanceScanGeneration(generation, await resolveGeneration(membership))) {
      return undefined
    }
    return parsed.data.classrooms.title
  } catch {
    return undefined
  }
}
