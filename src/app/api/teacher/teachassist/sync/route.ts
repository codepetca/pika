import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { runAttendanceSync } from '@/lib/teachassist/attendance-sync'
import type { TAExecutionMode } from '@/lib/teachassist/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/teacher/teachassist/sync
 *
 * Trigger a Playwright-based attendance sync from Pika to TeachAssist.
 *
 * Body:
 *   classroom_id: string (required)
 *   mode: 'dry_run' | 'execute' (default: 'dry_run')
 *   execution_mode?: 'confirmation' | 'full_auto' (overrides classroom config)
 *   date_range?: { from: string; to: string } (optional, YYYY-MM-DD)
 *
 * Returns:
 *   { jobId, ok, summary, errors, unmatchedStudents }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()

    const classroomId = String(body.classroom_id || '').trim()
    const mode = body.mode === 'execute' ? 'execute' : 'dry_run'

    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    // Parse optional date range
    let dateRange: { from: string; to: string } | undefined
    if (body.date_range && typeof body.date_range === 'object') {
      const from = String(body.date_range.from || '').trim()
      const to = String(body.date_range.to || '').trim()
      if (from && to) {
        dateRange = { from, to }
      }
    }

    // Parse optional execution mode override
    const executionMode: TAExecutionMode | undefined =
      body.execution_mode === 'full_auto' ? 'full_auto' :
      body.execution_mode === 'confirmation' ? 'confirmation' :
      undefined

    const result = await runAttendanceSync({
      classroomId,
      mode,
      createdBy: user.id,
      dateRange,
      executionMode,
    })

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('TeachAssist attendance sync error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
