import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { exportCourseBlueprintArchive } from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherCourseBlueprintExport', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await exportCourseBlueprintArchive(user.id, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const fileName =
    `${result.bundle.manifest.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'course-blueprint'}.course-package.tar`
  const archiveBody = Buffer.from(result.archive)

  return new NextResponse(archiveBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-tar',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
})
