import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { AdminPrototype } from '@/app/__ui/AdminPrototype'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminPrototypePage() {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_UI_GALLERY !== 'true') {
    notFound()
  }

  if (process.env.PIKA_E2E_FIXTURES !== 'true' && !await getCurrentUser()) {
    redirect(await getServerLoginRedirectPath())
  }

  return <AdminPrototype />
}
