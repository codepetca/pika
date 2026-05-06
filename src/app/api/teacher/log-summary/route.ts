import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import {
  restoreNames,
  type RawSummaryResponse,
} from '@/lib/log-summary'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/log-summary?classroom_id=xxx&date=YYYY-MM-DD
 * Returns a cached nightly summary of all student logs for the given date.
 */
export const GET = withErrorHandler('GetLogSummary', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')
  const date = searchParams.get('date')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'date is required (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const supabase = getServiceRoleClient()

  // Verify classroom ownership
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('teacher_id')
    .eq('id', classroomId)
    .single()

  if (classroomError || !classroom) {
    return NextResponse.json(
      { error: 'Classroom not found' },
      { status: 404 }
    )
  }

  if (classroom.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    )
  }

  // Get entry count and max updated_at for staleness check
  const { data: entryStats, error: statsError } = await supabase
    .from('entries')
    .select('updated_at')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (statsError) {
    console.error('Error fetching entry stats:', statsError)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  const { count: actualEntryCount, error: countError } = await supabase
    .from('entries')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', classroomId)
    .eq('date', date)

  if (countError) {
    console.error('Error counting entries:', countError)
    return NextResponse.json(
      { error: 'Failed to count entries' },
      { status: 500 }
    )
  }

  // No entries → no summary
  if (!actualEntryCount || actualEntryCount === 0) {
    return NextResponse.json({ summary: null, summary_status: 'no_entries' })
  }

  const maxUpdatedAt = entryStats?.[0]?.updated_at || null

  // Check cache
  const { data: cached } = await supabase
    .from('log_summaries')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .single()

  // Cache hit: fresh if correct format, entry count matches, AND no entries updated since generation
  const rawItems = cached?.summary_items as any
  const isNewFormat = rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems) && 'overview' in rawItems
  const isCacheFresh =
    cached &&
    isNewFormat &&
    cached.entry_count === actualEntryCount &&
    (!maxUpdatedAt || !cached.entries_updated_at || cached.entries_updated_at >= maxUpdatedAt)

  if (isCacheFresh) {
    const rawSummary: RawSummaryResponse = {
      overview: String(rawItems.overview || ''),
      action_items: Array.isArray(rawItems.action_items)
        ? rawItems.action_items.map((item: any) => ({
            text: String(item.text || ''),
            initials: String(item.initials || ''),
          }))
        : [],
    }
    const restored = restoreNames(
      rawSummary,
      cached.initials_map as Record<string, string>
    )

    return NextResponse.json({
      summary_status: 'ready',
      summary: {
        ...restored,
        generated_at: cached.generated_at,
      },
    })
  }

  return NextResponse.json({ summary: null, summary_status: 'pending' })
})
