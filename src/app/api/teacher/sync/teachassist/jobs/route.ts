import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { runTeachAssistSyncJob } from '@/lib/teachassist/engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()

    const classroomId = String(body.classroom_id || '').trim()
    const mode = body.mode === 'execute' ? 'execute' : 'dry_run'
    const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual'
    const payload = body.dataset || {}

    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const result = await runTeachAssistSyncJob({
      classroomId,
      mode,
      source,
      payload,
      createdBy: user.id,
    })

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Create TeachAssist sync job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
