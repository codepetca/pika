import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { UiGallery } from '../__ui/UiGallery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PatternLabPage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_UI_GALLERY !== 'true') {
    notFound()
  }

  const resolvedSearchParams = await searchParams

  if (process.env.PIKA_E2E_FIXTURES === 'true') {
    const fixtureRole = resolvedSearchParams?.role === 'student' ? 'student' : 'teacher'
    return <UiGallery role={fixtureRole} />
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

  return <UiGallery role={referenceRole} />
}
