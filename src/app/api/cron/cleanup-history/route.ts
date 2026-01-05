import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEZONE = 'America/Toronto'
const DEFAULT_CHUNK_SIZE = 200

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  const authHeader = getCronAuthHeader(request)
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoffDate = formatInTimeZone(
    subDays(new Date(), 30),
    TIMEZONE,
    'yyyy-MM-dd'
  )

  const supabase = getServiceRoleClient()

  const { data: classrooms, error: classroomsError } = await supabase
    .from('classrooms')
    .select('id')
    .not('end_date', 'is', null)
    .lt('end_date', cutoffDate)

  if (classroomsError) {
    console.error('Error fetching classrooms for cleanup:', classroomsError)
    return NextResponse.json(
      { error: 'Failed to fetch classrooms' },
      { status: 500 }
    )
  }

  const classroomIds = (classrooms || []).map((c: { id: string }) => c.id)
  if (classroomIds.length === 0) {
    return NextResponse.json({ status: 'ok', deleted: 0 })
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from('assignments')
    .select('id')
    .in('classroom_id', classroomIds)

  if (assignmentsError) {
    console.error('Error fetching assignments for cleanup:', assignmentsError)
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    )
  }

  const assignmentIds = (assignments || []).map((a: { id: string }) => a.id)
  if (assignmentIds.length === 0) {
    return NextResponse.json({ status: 'ok', deleted: 0 })
  }

  const { data: docs, error: docsError } = await supabase
    .from('assignment_docs')
    .select('id')
    .in('assignment_id', assignmentIds)

  if (docsError) {
    console.error('Error fetching assignment docs for cleanup:', docsError)
    return NextResponse.json(
      { error: 'Failed to fetch assignment docs' },
      { status: 500 }
    )
  }

  const docIds = (docs || []).map((d: { id: string }) => d.id)
  if (docIds.length === 0) {
    return NextResponse.json({ status: 'ok', deleted: 0 })
  }

  let deleted = 0
  for (let i = 0; i < docIds.length; i += DEFAULT_CHUNK_SIZE) {
    const chunk = docIds.slice(i, i + DEFAULT_CHUNK_SIZE)
    const { error: deleteError } = await supabase
      .from('assignment_doc_history')
      .delete()
      .in('assignment_doc_id', chunk)

    if (deleteError) {
      console.error('Error deleting assignment doc history:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete history' },
        { status: 500 }
      )
    }

    deleted += chunk.length
  }

  return NextResponse.json({ status: 'ok', deleted })
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
