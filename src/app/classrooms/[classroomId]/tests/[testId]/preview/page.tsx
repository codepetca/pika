import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ classroomId: string; testId: string }>
}

export default async function TestPreviewPage({ params }: PageProps) {
  const { classroomId, testId } = await params

  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
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
