import { chunkValues } from '@/lib/server/query-chunks'

const ENROLLMENT_FILTER_CHUNK_SIZE = 50

export async function validateClassroomStudentIds(
  supabase: any,
  classroomId: string,
  studentIds: string[],
): Promise<
  | { ok: true; enrolledStudentIds: Set<string>; missingStudentIds: string[] }
  | { ok: false; error: unknown }
> {
  const normalizedStudentIds = Array.from(
    new Set(studentIds.filter((studentId): studentId is string => typeof studentId === 'string' && studentId.length > 0)),
  )

  if (normalizedStudentIds.length === 0) {
    return {
      ok: true,
      enrolledStudentIds: new Set<string>(),
      missingStudentIds: [],
    }
  }

  const enrolledStudentIds = new Set<string>()

  for (const studentIdChunk of chunkValues(normalizedStudentIds, ENROLLMENT_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('classroom_enrollments')
      .select('student_id')
      .eq('classroom_id', classroomId)
      .in('student_id', studentIdChunk)

    if (error) {
      return { ok: false, error }
    }

    for (const row of (data || []) as Array<{ student_id: unknown }>) {
      if (typeof row.student_id === 'string' && row.student_id.length > 0) {
        enrolledStudentIds.add(row.student_id)
      }
    }
  }

  return {
    ok: true,
    enrolledStudentIds,
    missingStudentIds: normalizedStudentIds.filter((studentId) => !enrolledStudentIds.has(studentId)),
  }
}
