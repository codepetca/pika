import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { UiGallery } from '../__ui/UiGallery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PatternLabPage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string; fixture?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_UI_GALLERY !== 'true') {
    notFound()
  }

  const resolvedSearchParams = await searchParams

  if (process.env.PIKA_E2E_FIXTURES === 'true') {
    const fixtureRole = resolvedSearchParams?.role === 'student' ? 'student' : 'teacher'
    // Give the lazy client gallery a stable server parent without changing layout.
    return <div className="contents"><UiGallery role={fixtureRole}
      assignmentControllerFixture={resolvedSearchParams?.fixture === 'assignment-controller'}
      testControllerFixture={resolvedSearchParams?.fixture === 'test-controller'}
    /></div>
  }

  const user = await getCurrentUser()
  if (!user) {
    redirect(await getServerLoginRedirectPath())
  }

  const referenceRole = resolvedSearchParams?.role === 'student'
    ? 'student'
    : resolvedSearchParams?.role === 'teacher'
      ? 'teacher'
      : user.role

  return <div className="contents"><UiGallery role={referenceRole} /></div>
}
