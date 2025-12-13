import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { UiGallery } from './UiGallery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function UiGalleryPage() {
  if (process.env.ENABLE_UI_GALLERY !== 'true') {
    notFound()
  }

  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  return <UiGallery role={user.role} />
}

