/**
 * GET /api/snapshots/list
 *
 * Returns a list of all available snapshot images.
 * Used by the snapshot gallery to display all captured UI screenshots.
 */
import { NextResponse } from 'next/server'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SNAPSHOTS_DIR = join(process.cwd(), 'e2e', '__snapshots__', 'ui-snapshots.spec.ts-snapshots')

export async function GET() {
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
}
