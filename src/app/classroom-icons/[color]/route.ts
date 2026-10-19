import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { CLASSROOM_THEME_COLORS, getClassroomThemeDefinition, isClassroomThemeColor } from '@/lib/classroom-theme'

export const dynamic = 'force-static'

export function generateStaticParams() {
  return CLASSROOM_THEME_COLORS.map((color) => ({ color }))
}

export const GET = withErrorHandler('ClassroomIcon', async (_request, { params }) => {
  const { color } = await params
  if (!isClassroomThemeColor(color)) throw new ApiError(404, 'Unknown classroom color')
  const mark = await readFile(path.join(process.cwd(), 'public/pika-icon-dark.svg'), 'utf8')
  // Reuse the original white mark. The palette's deeper shade keeps it legible at tab size.
  const svg = mark.replace(
    '<image width="128" height="128"',
    `<rect width="128" height="128" rx="28" fill="${getClassroomThemeDefinition(color).textColor}" /><image x="12" y="12" width="104" height="104"`,
  )
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  })
})
