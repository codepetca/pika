/**
 * GET /api/snapshots/[filename]
 *
 * Serves snapshot images from the e2e snapshots directory.
 */
import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withErrorHandler } from '@/lib/api-handler'

const SNAPSHOTS_DIR = join(process.cwd(), 'e2e', '__snapshots__', 'ui-snapshots.spec.ts-snapshots')

export const GET = withErrorHandler('GetSnapshot', async (_request, context) => {
  const { filename } = await context.params

  // Security: only allow PNG files and prevent directory traversal
  if (!filename.endsWith('.png') || filename.includes('..') || filename.includes('/')) {
    return new NextResponse('Invalid filename', { status: 400 })
  }

  try {
    const filePath = join(SNAPSHOTS_DIR, filename)
    const imageBuffer = await readFile(filePath)

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new NextResponse('Snapshot not found', { status: 404 })
    }
    throw error
  }
})
