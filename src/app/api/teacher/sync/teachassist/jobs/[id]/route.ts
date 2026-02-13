import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    const { data: job, error: jobError } = await supabase
      .from('sync_jobs')
      .select('*, classrooms!inner(teacher_id)')
      .eq('id', id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Sync job not found' }, { status: 404 })
    }

    if (job.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: items, error: itemsError } = await supabase
      .from('sync_job_items')
      .select('*')
      .eq('sync_job_id', id)
      .order('created_at', { ascending: true })

    if (itemsError) {
      console.error('Error loading sync job items:', itemsError)
      return NextResponse.json({ error: 'Failed to load sync job items' }, { status: 500 })
    }

    return NextResponse.json({
      job: {
        id: job.id,
        classroom_id: job.classroom_id,
        provider: job.provider,
        mode: job.mode,
        status: job.status,
        source: job.source,
        summary: job.summary,
        error_message: job.error_message,
        started_at: job.started_at,
        finished_at: job.finished_at,
        created_at: job.created_at,
      },
      items: items || [],
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get TeachAssist sync job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
