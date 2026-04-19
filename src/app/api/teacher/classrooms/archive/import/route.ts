import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { importClassroomArchive } from '@/lib/server/classroom-archives'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherClassroomArchiveImport', async (request) => {
  const user = await requireRole('teacher')
  const result = await importClassroomArchive(user.id, await request.arrayBuffer())

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ classroom: result.classroom }, { status: 201 })
})
