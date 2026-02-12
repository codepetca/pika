import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { runTeachAssistSyncJob } from '@/lib/teachassist/engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    const { data: job, error } = await supabase
      .from('sync_jobs')
      .select('id, classroom_id, source, source_payload, classrooms!inner(teacher_id)')
      .eq('id', id)
      .single()

    if (error || !job) {
      return NextResponse.json({ error: 'Sync job not found' }, { status: 404 })
    }

    if (job.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await runTeachAssistSyncJob({
      classroomId: job.classroom_id,
      mode: 'execute',
      source: `${job.source}:retry`,
      payload: job.source_payload || {},
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

    console.error('Retry TeachAssist sync job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
