import { z } from 'zod'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireAuth, requireRole } from '@/lib/auth'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { readRepoLightRemovedTargetsPage } from '@/lib/server/repolight-removed-student-cleanup'
import { isManualRepoLightCleanupEnabled } from '@/lib/server/live-student-cleanup'
import { repoLightCleanupTargetsReplySchema } from '@/lib/validations/live-student-cleanup'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const GET = withErrorHandler('GetRepoLightCleanupTargets', async (request, context) => {
  const candidate = isClassroomExperienceAdmissionConfigured() ? await requireAuth() : null
  const admitted = candidate !== null && resolveClassroomExperienceAdmission(candidate).status === 'admitted'
  const user = admitted && candidate ? candidate : await requireRole('teacher')
  const classroomId = z.string().uuid().parse((await context.params).id).toLowerCase()
  const query = z.object({ afterStudentId: z.string().uuid().optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams))
  const page = await readRepoLightRemovedTargetsPage(user.id.toLowerCase(), classroomId, query.afterStudentId?.toLowerCase() ?? null)
  const rows = page.targets
  const enabled = isManualRepoLightCleanupEnabled()
  const targets = rows.filter(row => row.pending_subject_count > 0 || row.status === 'cleanup_pending').map(row => ({
    student_id: row.student_id, generation_id: row.generation_id, email: row.email ?? '',
    name: row.name ?? 'Repository reports', scope: 'repolight_only' as const, report_cleanup_available: true,
  }))
  return NextResponse.json(repoLightCleanupTargetsReplySchema.parse({ targets, enabled, nextStudentId: page.next_student_id }), { headers: { 'Cache-Control': 'no-store' } })
})
