import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { exportClassroomArchive } from '@/lib/server/classroom-archives'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherClassroomArchive', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await exportClassroomArchive(user.id, id)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const archiveBody = Buffer.from(result.archive)
  const fileName = `${result.manifest.classroom_title.replace(/\s+/g, '-').toLowerCase() || 'classroom'}.classroom-archive.tar`

  return new NextResponse(archiveBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-tar',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
})
