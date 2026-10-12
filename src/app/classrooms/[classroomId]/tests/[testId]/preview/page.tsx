import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import { resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { readContextualTestDetail } from '@/lib/server/contextual-test-detail-read'
import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ classroomId: string; testId: string }>
}

export default async function TestPreviewPage({ params }: PageProps) {
  const { classroomId, testId } = await params

  const user = await getCurrentUser()
  if (!user) {
    redirect(await getServerLoginRedirectPath())
  }
  if (resolveClassroomExperienceAdmission(user).status === 'admitted') {
    let detail
    try {
      detail = await readContextualTestDetail({ supabase: getServiceRoleClient(), actorId: user.id, testId })
    } catch (error) {
      if (error instanceof ApiError && [400, 403, 404].includes(error.statusCode)) notFound()
      throw error
    }
    if (detail.test.id !== testId || detail.test.classroom_id !== classroomId) notFound()
    return <TeacherTestPreviewPage classroomId={classroomId} testId={testId} />
  }
  if (user.role !== 'teacher') {
    notFound()
  }

  const access = await assertTeacherOwnsTest(user.id, testId)
  if (!access.ok) {
    notFound()
  }
  if (access.test.classroom_id !== classroomId) {
    notFound()
  }

  return <TeacherTestPreviewPage classroomId={classroomId} testId={testId} />
}
