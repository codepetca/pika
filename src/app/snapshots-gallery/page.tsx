/**
 * Snapshot Gallery Page
 *
 * Displays all captured UI screenshots from Playwright tests.
 * Navigate to /__snapshots to view all snapshots in a grid layout.
 *
 * Each snapshot is clickable to view full-size in a new tab.
 */
import { SnapshotGallery } from './SnapshotGallery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function SnapshotsPage() {
  return <SnapshotGallery />
}
