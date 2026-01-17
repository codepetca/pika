import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { isOnTime, getTodayInToronto } from '@/lib/timezone'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import {
  countCharacters,
  extractPlainText,
  isValidTiptapContent,
  plainTextToTiptapContent,
} from '@/lib/tiptap-content'
import { tryApplyJsonPatch } from '@/lib/json-patch'
import type { JsonPatchOperation, MoodEmoji, TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const VALID_MOODS: MoodEmoji[] = ['😊', '🙂', '😐']
const MAX_CHARS = 2000

type EntryContentPayload = {
  classroom_id: string
  date: string
  text?: string
  rich_content?: TiptapContent
  minutes_reported?: number | null
  mood?: MoodEmoji | null
}

type EntryPatchPayload = {
  classroom_id: string
  date: string
  entry_id?: string
  version: number
  rich_content?: TiptapContent
  patch?: JsonPatchOperation[]
}

function normalizeContent(
  content?: TiptapContent | null,
  text?: string | null
): TiptapContent {
  if (content) return content
  if (text) return plainTextToTiptapContent(text)
  return { type: 'doc', content: [] } as TiptapContent
}

function isValidDateString(date: string) {
  return DATE_REGEX.test(date)
}

async function verifyClassDay(
  supabase: ReturnType<typeof getServiceRoleClient>,
  classroomId: string,
  date: string
) {
  const { data: classDay, error: classDayError } = await supabase
    .from('class_days')
    .select('is_class_day')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .single()

  if (classDayError && classDayError.code !== 'PGRST116') {
    console.error('Error fetching class day:', classDayError)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Failed to validate class day' }, { status: 500 }),
    }
  }

  if (!classDay?.is_class_day) {
    return { ok: false, response: NextResponse.json({ error: 'Not a class day' }, { status: 400 }) }
  }

  return { ok: true as const }
}

function validateContentPayload(content: TiptapContent) {
  if (!isValidTiptapContent(content)) {
    return { ok: false, error: 'Invalid rich_content format' }
  }

  if (countCharacters(content) > MAX_CHARS) {
    return { ok: false, error: 'Entry exceeds 2000 character limit' }
  }

  return { ok: true as const }
}

/**
 * GET /api/student/entries?classroom_id=xxx&limit=<n>
 * Fetches entries for the current student (most recent first).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const supabase = getServiceRoleClient()

    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')
    const limitParam = searchParams.get('limit')

    let limit: number | null = null
    if (limitParam) {
      const parsed = Number.parseInt(limitParam, 10)
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100)
      }
    }

    let query = supabase
      .from('entries')
      .select('*')
      .eq('student_id', user.id)

    if (classroomId) {
      const access = await assertStudentCanAccessClassroom(user.id, classroomId)
      if (!access.ok) {
        return NextResponse.json(
          { error: access.error },
          { status: access.status }
        )
      }
      query = query.eq('classroom_id', classroomId)
    } else {
      const { data: enrollments, error: enrollmentError } = await supabase
        .from('classroom_enrollments')
        .select('classroom_id, classrooms!inner(archived_at)')
        .eq('student_id', user.id)
        .is('classrooms.archived_at', null)

      if (enrollmentError) {
        console.error('Error fetching classrooms:', enrollmentError)
        return NextResponse.json(
          { error: 'Failed to fetch entries' },
          { status: 500 }
        )
      }

      const classroomIds = enrollments?.map((e: any) => e.classroom_id) || []
      if (classroomIds.length === 0) {
        return NextResponse.json({ entries: [] })
      }

      query = query.in('classroom_id', classroomIds)
    }

    if (limit !== null) {
      query = query.limit(limit)
    }

    const { data: entries, error } = await query.order('date', { ascending: false })

    if (error) {
      console.error('Error fetching entries:', error)
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      )
    }

    return NextResponse.json({ entries })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get entries error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/student/entries
 * Creates or updates an entry for the current student
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const body = (await request.json()) as EntryContentPayload

    const { classroom_id, date, text, rich_content, minutes_reported, mood } = body

    if (!classroom_id || !date) {
      return NextResponse.json(
        { error: 'classroom_id and date are required' },
        { status: 400 }
      )
    }

    if (!isValidDateString(date)) {
      return NextResponse.json(
        { error: 'Invalid date format (use YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    if (mood && !VALID_MOODS.includes(mood)) {
      return NextResponse.json(
        { error: 'Invalid mood value' },
        { status: 400 }
      )
    }

    const content = normalizeContent(rich_content, text)

    const contentValidation = validateContentPayload(content)
    if (!contentValidation.ok) {
      return NextResponse.json({ error: contentValidation.error }, { status: 400 })
    }

    const entryText = extractPlainText(content)

    const supabase = getServiceRoleClient()

    const access = await assertStudentCanAccessClassroom(user.id, classroom_id)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }

    const todayToronto = getTodayInToronto()
    if (date > todayToronto) {
      return NextResponse.json(
        { error: 'Cannot submit entries for future dates' },
        { status: 400 }
      )
    }

    const classDayCheck = await verifyClassDay(supabase, classroom_id, date)
    if (!classDayCheck.ok) {
      return classDayCheck.response
    }

    const now = new Date()
    const onTime = isOnTime(now, date)

    const { data: existing, error: existingError } = await supabase
      .from('entries')
      .select('id, version')
      .eq('student_id', user.id)
      .eq('classroom_id', classroom_id)
      .eq('date', date)
      .single()

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error fetching existing entry:', existingError)
      return NextResponse.json(
        { error: 'Failed to fetch entry' },
        { status: 500 }
      )
    }

    let entry

    if (existing) {
      const nextVersion = (existing.version ?? 1) + 1
      const { data, error } = await supabase
        .from('entries')
        .update({
          text: entryText,
          rich_content: content,
          minutes_reported,
          mood,
          on_time: onTime,
          version: nextVersion,
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating entry:', error)
        return NextResponse.json(
          { error: 'Failed to update entry' },
          { status: 500 }
        )
      }

      entry = data
    } else {
      const { data, error } = await supabase
        .from('entries')
        .insert({
          student_id: user.id,
          classroom_id,
          date,
          text: entryText,
          rich_content: content,
          minutes_reported,
          mood,
          on_time: onTime,
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating entry:', error)
        return NextResponse.json(
          { error: 'Failed to create entry' },
          { status: 500 }
        )
      }

      entry = data
    }

    return NextResponse.json({ entry })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Create/update entry error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/student/entries
 * Applies JSON Patch or full-content updates with optimistic concurrency.
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const body = (await request.json()) as EntryPatchPayload

    const { classroom_id, date, entry_id, version, rich_content, patch } = body

    if (!classroom_id || !date) {
      return NextResponse.json(
        { error: 'classroom_id and date are required' },
        { status: 400 }
      )
    }

    if (!isValidDateString(date)) {
      return NextResponse.json(
        { error: 'Invalid date format (use YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(version)) {
      return NextResponse.json(
        { error: 'version is required' },
        { status: 400 }
      )
    }

    if (!rich_content && !patch) {
      return NextResponse.json(
        { error: 'rich_content or patch is required' },
        { status: 400 }
      )
    }

    if (patch && !Array.isArray(patch)) {
      return NextResponse.json(
        { error: 'Invalid patch format' },
        { status: 400 }
      )
    }

    if (rich_content && !isValidTiptapContent(rich_content)) {
      return NextResponse.json(
        { error: 'Invalid rich_content format' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const access = await assertStudentCanAccessClassroom(user.id, classroom_id)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }

    const todayToronto = getTodayInToronto()
    if (date > todayToronto) {
      return NextResponse.json(
        { error: 'Cannot submit entries for future dates' },
        { status: 400 }
      )
    }

    const classDayCheck = await verifyClassDay(supabase, classroom_id, date)
    if (!classDayCheck.ok) {
      return classDayCheck.response
    }

    let entryQuery = supabase
      .from('entries')
      .select('id, version, text, rich_content')
      .eq('student_id', user.id)
      .eq('classroom_id', classroom_id)
      .eq('date', date)

    if (entry_id) {
      entryQuery = entryQuery.eq('id', entry_id)
    }

    const { data: existing, error: existingError } = await entryQuery.single()

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error fetching entry:', existingError)
      return NextResponse.json(
        { error: 'Failed to fetch entry' },
        { status: 500 }
      )
    }

    if (!existing) {
      if (patch) {
        return NextResponse.json(
          { error: 'Entry not found' },
          { status: 404 }
        )
      }

      const content = normalizeContent(rich_content, null)
      const contentValidation = validateContentPayload(content)
      if (!contentValidation.ok) {
        return NextResponse.json({ error: contentValidation.error }, { status: 400 })
      }

      const entryText = extractPlainText(content)
      const now = new Date()
      const onTime = isOnTime(now, date)

      const { data, error } = await supabase
        .from('entries')
        .insert({
          student_id: user.id,
          classroom_id,
          date,
          text: entryText,
          rich_content: content,
          on_time: onTime,
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating entry:', error)
        return NextResponse.json(
          { error: 'Failed to create entry' },
          { status: 500 }
        )
      }

      return NextResponse.json({ entry: data })
    }

    const currentVersion = existing.version ?? 1
    if (version !== currentVersion) {
      const normalizedEntry = {
        ...existing,
        rich_content: normalizeContent(existing.rich_content, existing.text),
      }
      return NextResponse.json(
        { error: 'Entry has been updated elsewhere', entry: normalizedEntry },
        { status: 409 }
      )
    }

    let nextContent: TiptapContent

    if (patch && patch.length > 0) {
      const baseContent = normalizeContent(existing.rich_content, existing.text)
      const patched = tryApplyJsonPatch(baseContent, patch)
      if (!patched.success) {
        return NextResponse.json(
          { error: 'Invalid patch' },
          { status: 400 }
        )
      }
      nextContent = patched.content
    } else if (patch && patch.length === 0) {
      return NextResponse.json({ entry: existing })
    } else {
      nextContent = normalizeContent(rich_content, null)
    }

    const contentValidation = validateContentPayload(nextContent)
    if (!contentValidation.ok) {
      return NextResponse.json({ error: contentValidation.error }, { status: 400 })
    }

    const entryText = extractPlainText(nextContent)
    const now = new Date()
    const onTime = isOnTime(now, date)
    const nextVersion = currentVersion + 1

    const { data, error } = await supabase
      .from('entries')
      .update({
        text: entryText,
        rich_content: nextContent,
        on_time: onTime,
        version: nextVersion,
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating entry:', error)
      return NextResponse.json(
        { error: 'Failed to update entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({ entry: data })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Patch entry error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
