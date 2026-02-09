import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { extractPlainText, isValidTiptapContent } from '@/lib/tiptap-content'
import {
  buildInitialsMap,
  sanitizeEntryText,
  buildSummaryPrompt,
  callOpenAIForSummary,
  restoreNames,
  getSummaryModel,
  type RawSummaryResponse,
} from '@/lib/log-summary'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/log-summary?classroom_id=xxx&date=YYYY-MM-DD
 * Returns an AI-generated summary of all student logs for the given date.
 */
export async function GET(request: NextRequest) {
  try {
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
      return NextResponse.json({ summary: null })
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
        summary: {
          ...restored,
          generated_at: cached.generated_at,
        },
      })
    }

    // Generate new summary
    const summary = await generateSummary(supabase, classroomId, date, actualEntryCount, maxUpdatedAt)
    return NextResponse.json({ summary })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Log summary error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function generateSummary(
  supabase: ReturnType<typeof getServiceRoleClient>,
  classroomId: string,
  date: string,
  entryCount: number,
  entriesUpdatedAt: string | null
) {
  // Fetch entries and student profiles
  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('date', date)

  if (entriesError || !entries?.length) {
    return null
  }

  const studentIds = [...new Set(entries.map((e) => e.student_id))]

  const { data: profiles } = await supabase
    .from('student_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', studentIds)

  const profileMap = new Map(
    (profiles || []).map((p) => [p.user_id, p])
  )

  // Build unique students list (deduplicate by student_id)
  const students = studentIds
    .map((id) => {
      const profile = profileMap.get(id)
      return {
        studentId: id,
        firstName: profile?.first_name || '',
        lastName: profile?.last_name || '',
      }
    })
    .filter((s) => s.firstName || s.lastName)

  const initialsMap = buildInitialsMap(students)

  // Build reverse map for quick lookup
  const nameToInitials: Record<string, string> = {}
  for (const [initials, fullName] of Object.entries(initialsMap)) {
    nameToInitials[fullName] = initials
  }

  // Sanitize entries and build logs
  const sanitizedLogs: { initials: string; text: string }[] = []
  for (const entry of entries) {
    const profile = profileMap.get(entry.student_id)
    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
    const initials = nameToInitials[fullName] || '?'

    let text = ''
    if (entry.rich_content && isValidTiptapContent(entry.rich_content)) {
      text = extractPlainText(entry.rich_content as TiptapContent)
    }
    if (!text.trim() && entry.text) {
      text = entry.text
    }

    if (!text.trim()) continue

    const sanitized = sanitizeEntryText(text, students, initialsMap)
    sanitizedLogs.push({ initials, text: sanitized })
  }

  if (sanitizedLogs.length === 0) {
    return null
  }

  // Call OpenAI
  const { system, user } = buildSummaryPrompt(date, sanitizedLogs)
  const rawResponse = await callOpenAIForSummary(system, user)
  const restored = restoreNames(rawResponse, initialsMap)

  // Store raw response (with initials) for cache
  const summaryItemsForStorage = {
    overview: rawResponse.overview,
    action_items: rawResponse.action_items.map((item) => ({
      text: item.text,
      initials: item.initials,
    })),
  }

  const model = getSummaryModel()
  const now = new Date().toISOString()

  // Upsert into cache
  const { error: upsertError } = await supabase.from('log_summaries').upsert(
    {
      classroom_id: classroomId,
      date,
      summary_items: summaryItemsForStorage,
      initials_map: initialsMap,
      entry_count: entryCount,
      entries_updated_at: entriesUpdatedAt,
      model,
      generated_at: now,
    },
    { onConflict: 'classroom_id,date' }
  )

  if (upsertError) {
    console.error('Error upserting log summary:', upsertError)
  }

  return {
    ...restored,
    generated_at: now,
  }
}
