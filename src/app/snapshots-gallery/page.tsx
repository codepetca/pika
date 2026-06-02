/**
 * Snapshot Gallery Page
 *
 * Displays all captured UI screenshots from Playwright tests.
 * Navigate to /__snapshots to view all snapshots in a grid layout.
 *
 * Each snapshot is clickable to view full-size in a new tab.
 */
import { AuthenticationError, AuthorizationError, requireSnapshotGalleryAccess } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import { SnapshotGallery } from './SnapshotGallery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SnapshotsPage() {
  if (process.env.ENABLE_UI_GALLERY !== 'true') {
    notFound()
  }

  try {
    await requireSnapshotGalleryAccess()
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect('/login')
    }

    if (error instanceof AuthorizationError) {
      notFound()
    }

    throw error
  }

  return <SnapshotGallery />
}
