import { notFound } from 'next/navigation'
import { AdminPrototype } from '@/app/__ui/AdminPrototype'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AdminPrototypePage() {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_UI_GALLERY !== 'true') {
    notFound()
  }

  return <AdminPrototype />
}
