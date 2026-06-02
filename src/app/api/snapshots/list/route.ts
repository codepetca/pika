/**
 * GET /api/snapshots/list
 *
 * Returns a list of all available snapshot images.
 * Used by the snapshot gallery to display all captured UI screenshots.
 */
import { NextResponse } from 'next/server'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withErrorHandler } from '@/lib/api-handler'
import { requireSnapshotGalleryAccess } from '@/lib/auth'

const SNAPSHOTS_DIR = join(process.cwd(), 'e2e', '__snapshots__', 'ui-snapshots.spec.ts-snapshots')

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetSnapshotList', async () => {
  if (process.env.ENABLE_UI_GALLERY !== 'true') {
    return new NextResponse('Not found', { status: 404 })
  }

  await requireSnapshotGalleryAccess()

  try {
    const files = await readdir(SNAPSHOTS_DIR)
    const snapshots = files
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((filename) => ({
        filename,
        // Convert filename to readable name
        name: filename
          .replace('-chromium-desktop-darwin.png', '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      }))

    return NextResponse.json({ snapshots })
  } catch (error) {
    // If directory doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ snapshots: [] })
    }
    throw error
  }
})
