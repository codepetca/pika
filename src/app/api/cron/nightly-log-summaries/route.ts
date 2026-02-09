import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { getServiceRoleClient } from '@/lib/supabase'
import { extractPlainText, isValidTiptapContent } from '@/lib/tiptap-content'
import {
  buildInitialsMap,
  sanitizeEntryText,
  buildSummaryPrompt,
  callOpenAIForSummary,
  getSummaryModel,
} from '@/lib/log-summary'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEZONE = 'America/Toronto'
const CONCURRENCY_LIMIT = 5

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

  const supabase = getServiceRoleClient()
  const yesterday = formatInTimeZone(
    subDays(new Date(), 1),
    TIMEZONE,
    'yyyy-MM-dd'
  )

  // Find only classrooms that had entries yesterday (single query)
  const { data: activeEntries, error: entriesError } = await supabase
    .from('entries')
    .select('classroom_id')
    .eq('date', yesterday)

  if (entriesError) {
    console.error('Error fetching active classrooms:', entriesError)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  const classroomIds = [...new Set((activeEntries || []).map((e: { classroom_id: string }) => e.classroom_id))]
  if (classroomIds.length === 0) {
    return NextResponse.json({ status: 'ok', generated: 0, skipped: 0 })
  }

  let generated = 0
  let skipped = 0

  // Process classrooms with concurrency limit
  for (let i = 0; i < classroomIds.length; i += CONCURRENCY_LIMIT) {
    const batch = classroomIds.slice(i, i + CONCURRENCY_LIMIT)
    const results = await Promise.allSettled(
      batch.map((classroomId) =>
        generateSummaryForClassroom(supabase, classroomId, yesterday)
      )
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value) {
          generated++
        } else {
          skipped++
        }
      } else {
        console.error('Error generating summary:', result.reason)
        skipped++
      }
    }
  }

  return NextResponse.json({ status: 'ok', generated, skipped })
}

async function generateSummaryForClassroom(
  supabase: ReturnType<typeof getServiceRoleClient>,
  classroomId: string,
  date: string
): Promise<boolean> {
  // Fetch entries for this classroom and date
  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('date', date)

  if (entriesError) {
    console.error(`Error fetching entries for classroom ${classroomId}:`, entriesError)
    return false
  }

  if (!entries || entries.length === 0) {
    return false
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

  const nameToInitials: Record<string, string> = {}
  for (const [initials, fullName] of Object.entries(initialsMap)) {
    nameToInitials[fullName] = initials
  }

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
    return false
  }

  const { system, user } = buildSummaryPrompt(date, sanitizedLogs)
  const rawItems = await callOpenAIForSummary(system, user)

  const summaryItemsForStorage = rawItems.map((item) => ({
    text: item.text,
    type: item.type,
    initials: item.initials,
  }))

  const model = getSummaryModel()

  // Get max updated_at from entries for staleness tracking
  const maxUpdatedAt = entries.reduce((max, e) => {
    return !max || e.updated_at > max ? e.updated_at : max
  }, '' as string) || null

  const { error: upsertError } = await supabase.from('log_summaries').upsert(
    {
      classroom_id: classroomId,
      date,
      summary_items: summaryItemsForStorage,
      initials_map: initialsMap,
      entry_count: entries.length,
      entries_updated_at: maxUpdatedAt,
      model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'classroom_id,date' }
  )

  if (upsertError) {
    console.error(`Error upserting summary for classroom ${classroomId}:`, upsertError)
    return false
  }

  return true
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
