import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { isOnTime, getTodayInToronto } from '@/lib/timezone'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import {
  countCharacters,
  extractPlainText,
  isValidTiptapContent,
  plainTextToTiptapContent,
} from '@/lib/tiptap-content'
import { tryApplyJsonPatch } from '@/lib/json-patch'
import { withErrorHandler } from '@/lib/api-handler'
import { isClassroomPalRequested } from '@/lib/server/pal-config'
import { prepareDailyLogPal, deliverDailyLogPal } from '@/lib/server/daily-log-pal'
import {
  type PalImmediateDeliveryStatus,
} from '@/lib/server/pal-outbox'
import { upsertStudentEntryWithPalEvent } from '@/lib/server/pal-source-writes'
import { authorizeContextualDailyLogRequest } from '@/lib/server/contextual-daily-log-access'
import { authorizeDailyLogReadActor, readContextualDailyLogs } from '@/lib/server/contextual-daily-log-read'
import {
  saveContextualDailyLog,
  verifyContextualDailyLogPatchPreimage,
  verifyContextualDailyLogPostPreimage,
} from '@/lib/server/contextual-daily-log-save'
import type { TiptapContent } from '@/types'
import { dailyLogPostSchema, dailyLogPatchSchema, DAILY_LOG_MAX_WIRE_BYTES, withinDailyLogWireLimit } from '@/lib/validations/daily-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_CHARS = 2000
const DEFAULT_BROAD_ENTRIES_LIMIT = 100
const MAX_ENTRIES_LIMIT = 100

function normalizeContent(
  content?: TiptapContent | null,
  text?: string | null
): TiptapContent {
  if (content) return content
  if (text) return plainTextToTiptapContent(text)
  return { type: 'doc', content: [] } as TiptapContent
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
  if (!withinDailyLogWireLimit(content)) {
    return { ok: false, error: 'Daily Log content exceeds size limit' }
  }
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
export const GET = withErrorHandler('GetStudentEntries', async (request, context) => {
  const readAccess = await authorizeDailyLogReadActor()
  const user = readAccess.user
  const supabase = getServiceRoleClient()

  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')
  const limitParam = searchParams.get('limit')

  let limit: number | null = classroomId ? null : DEFAULT_BROAD_ENTRIES_LIMIT
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_ENTRIES_LIMIT)
    }
  }

  if (readAccess.mode === 'contextual') {
    const entries = await readContextualDailyLogs({ supabase, actorId: user.id, classroomId, limit })
    return NextResponse.json({ entries })
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
})

/**
 * POST /api/student/entries
 * Creates or updates an entry for the current student
 */
export const POST = withErrorHandler('PostStudentEntry', async (request, context) => {
  let bodyPromise: Promise<ReturnType<typeof dailyLogPostSchema.parse>> | undefined
  const readBody = () => bodyPromise ??= (async () => dailyLogPostSchema.parse(await request.json()))()
  const dailyLogAccess = await authorizeContextualDailyLogRequest(async () => (await readBody()).classroom_id)
  const { classroom_id, date, text, rich_content, minutes_reported, mood, entry_id, version } = await readBody()

  const content = normalizeContent(rich_content, text)

  const contentValidation = validateContentPayload(content)
  if (!contentValidation.ok) {
    return NextResponse.json({ error: contentValidation.error }, { status: 400 })
  }

  const entryText = extractPlainText(content)

  const user = dailyLogAccess.user
  const supabase = getServiceRoleClient()

  if (dailyLogAccess.mode === 'legacy') {
    const access = await assertStudentCanAccessClassroom(user.id, classroom_id)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }
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

  if (dailyLogAccess.mode === 'contextual') {
    const { data: preimage, error: preimageError } = await supabase
      .from('entries')
      .select('id, student_id, classroom_id, date, version, minutes_reported, mood')
      .eq('student_id', user.id)
      .eq('classroom_id', classroom_id)
      .eq('date', date)
      .single()
    if (preimageError && preimageError.code !== 'PGRST116') {
      return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 })
    }
    const contextualExisting = verifyContextualDailyLogPostPreimage({
      actorId: user.id, classroomId: classroom_id, date, entry: preimage,
    })
    if ((entry_id !== undefined && entry_id !== contextualExisting?.id)
      || (version !== undefined && version !== (contextualExisting?.version ?? 0))) {
      return NextResponse.json({ error: 'Entry has been updated elsewhere', entry: contextualExisting }, { status: 409 })
    }
    const pal = prepareDailyLogPal({ learnerId: user.id, activityDay: date, occurredAt: now, text: entryText })
    const result = await saveContextualDailyLog({
      supabase,
      actorId: user.id,
      classroomId: classroom_id,
      date,
      text: entryText,
      richContent: content,
      minutesReported: minutes_reported === undefined ? contextualExisting?.minutes_reported : minutes_reported,
      mood: mood === undefined ? contextualExisting?.mood : mood,
      onTime,
      palEvent: pal.event,
      expectedVersion: contextualExisting?.version ?? null,
      expectedEntryId: contextualExisting?.id ?? null,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error, entry: result.entry }, { status: result.status })
    }
    const palDelivery = pal.event || isClassroomPalRequested()
      ? await deliverDailyLogPal({ event: pal.event, supabase, membership: { studentId: user.id, classroomId: classroom_id } })
      : undefined
    return NextResponse.json({ entry: result.entry, pal_delivery: palDelivery })
  }

  const { data: existing, error: existingError } = await supabase
    .from('entries')
    .select('id, version, minutes_reported, mood')
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

  if ((entry_id !== undefined && entry_id !== existing?.id)
    || (version !== undefined && version !== (existing ? existing.version ?? 1 : 0))) {
    return NextResponse.json({ error: 'Entry has been updated elsewhere', entry: existing ?? null }, { status: 409 })
  }

  // Re-read by the caller's exact subject/classroom/date when a competing write wins.
  const entryConflict = async () => {
    const { data: latest, error } = await supabase.from('entries')
      .select('id, version, text, rich_content, minutes_reported, mood')
      .eq('student_id', user.id).eq('classroom_id', classroom_id).eq('date', date).maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 })
    return NextResponse.json({ error: 'Entry has been updated elsewhere', entry: latest }, { status: 409 })
  }

  let entry
  let palDelivery: PalImmediateDeliveryStatus | undefined

  const pal = prepareDailyLogPal({ learnerId: user.id, activityDay: date, occurredAt: now, text: entryText })
  const palEvent = pal.event
  if (pal.enabled) {
    const preservedMinutes = minutes_reported === undefined
      ? existing?.minutes_reported
      : minutes_reported
    const preservedMood = mood === undefined ? existing?.mood : mood

    try {
      const result = await upsertStudentEntryWithPalEvent({
        supabase,
        studentId: user.id,
        classroomId: classroom_id,
        date,
        text: entryText,
        richContent: content,
        minutesReported: preservedMinutes,
        mood: preservedMood,
        onTime,
        expectedVersion: existing?.version ?? null,
        event: palEvent,
      })
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, entry: result.entry },
          { status: result.status },
        )
      }
      entry = result.entry
      if (palEvent || isClassroomPalRequested()) {
        palDelivery = await deliverDailyLogPal({
          membership: { studentId: user.id, classroomId: classroom_id },
          event: palEvent,
          supabase,
        })
      }
    } catch (error) {
      console.error('Error saving entry with Pal outbox:', error)
      return NextResponse.json(
        { error: existing ? 'Failed to update entry' : 'Failed to create entry' },
        { status: 500 }
      )
    }
  } else if (existing) {
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
      .eq('version', existing.version ?? 1)
      .select()
      .maybeSingle()

    if (error) {
      console.error('Error updating entry:', error)
      return NextResponse.json(
        { error: 'Failed to update entry' },
        { status: 500 }
      )
    }

    if (!data) return entryConflict()
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
      if (error.code === '23505') return entryConflict()
      console.error('Error creating entry:', error)
      return NextResponse.json(
        { error: 'Failed to create entry' },
        { status: 500 }
      )
    }

    entry = data
  }

  return NextResponse.json({ entry, pal_delivery: palDelivery })
})

/**
 * PATCH /api/student/entries
 * Applies JSON Patch or full-content updates with optimistic concurrency.
 */
export const PATCH = withErrorHandler('PatchStudentEntry', async (request, context) => {
  let bodyPromise: Promise<ReturnType<typeof dailyLogPatchSchema.parse>> | undefined
  const readBody = () => bodyPromise ??= (async () => dailyLogPatchSchema.parse(await request.json()))()
  const dailyLogAccess = await authorizeContextualDailyLogRequest(async () => (await readBody()).classroom_id)
  const { classroom_id, date, entry_id, version, rich_content, patch } = await readBody()

  const user = dailyLogAccess.user
  const supabase = getServiceRoleClient()

  if (dailyLogAccess.mode === 'legacy') {
    const access = await assertStudentCanAccessClassroom(user.id, classroom_id)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }
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

  const entryQuery = supabase
    .from('entries')
    .select('*')
    .eq('student_id', user.id)
    .eq('classroom_id', classroom_id)
    .eq('date', date)

  const { data: existing, error: existingError } = await entryQuery.single()

  if (existingError && existingError.code !== 'PGRST116') {
    console.error('Error fetching entry:', existingError)
    return NextResponse.json(
      { error: 'Failed to fetch entry' },
      { status: 500 }
    )
  }

  const contextualExisting = dailyLogAccess.mode === 'contextual'
    ? verifyContextualDailyLogPatchPreimage({
      actorId: user.id,
      classroomId: classroom_id,
      date,
      entry: existing,
    })
    : null

  if (dailyLogAccess.mode === 'contextual') {
    if (!contextualExisting) {
      if (patch) {
        return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
      }
      if (entry_id) {
        return NextResponse.json(
          { error: 'Entry has been updated elsewhere', entry: null },
          { status: 409 },
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
      const pal = prepareDailyLogPal({ learnerId: user.id, activityDay: date, occurredAt: now, text: entryText })
      const result = await saveContextualDailyLog({
        supabase,
        actorId: user.id,
        classroomId: classroom_id,
        date,
        text: entryText,
        richContent: content,
        onTime,
        palEvent: pal.event,
        expectedVersion: null,
        expectedEntryId: null,
      })
      if (!result.ok) {
        return NextResponse.json({ error: result.error, entry: result.entry }, { status: result.status })
      }
      const palDelivery = pal.event || isClassroomPalRequested()
        ? await deliverDailyLogPal({ event: pal.event, supabase, membership: { studentId: user.id, classroomId: classroom_id } })
        : undefined
      return NextResponse.json({ entry: result.entry, pal_delivery: palDelivery })
    }

    const currentVersion = contextualExisting.version
    if (!entry_id || entry_id !== contextualExisting.id || version !== currentVersion) {
      const normalizedEntry = {
        ...contextualExisting,
        rich_content: normalizeContent(contextualExisting.rich_content, contextualExisting.text),
      }
      return NextResponse.json(
        { error: 'Entry has been updated elsewhere', entry: normalizedEntry },
        { status: 409 },
      )
    }
    let nextContent: TiptapContent
    if (patch && patch.length > 0) {
      const patched = tryApplyJsonPatch(normalizeContent(contextualExisting.rich_content, contextualExisting.text), patch, { maxContentBytes: DAILY_LOG_MAX_WIRE_BYTES })
      if (!patched.success) return NextResponse.json({ error: 'Invalid patch' }, { status: 400 })
      nextContent = patched.content
    } else if (patch && patch.length === 0) {
      nextContent = normalizeContent(contextualExisting.rich_content, contextualExisting.text)
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
    const pal = prepareDailyLogPal({ learnerId: user.id, activityDay: date, occurredAt: now, text: entryText })
    const result = await saveContextualDailyLog({
      supabase,
      actorId: user.id,
      classroomId: classroom_id,
      date,
      text: entryText,
      richContent: nextContent,
      minutesReported: contextualExisting.minutes_reported,
      mood: contextualExisting.mood,
      onTime,
      palEvent: pal.event,
      expectedVersion: currentVersion,
      expectedEntryId: contextualExisting.id,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error, entry: result.entry }, { status: result.status })
    }
    const palDelivery = pal.event || isClassroomPalRequested()
      ? await deliverDailyLogPal({ event: pal.event, supabase, membership: { studentId: user.id, classroomId: classroom_id } })
      : undefined
    return NextResponse.json({ entry: result.entry, pal_delivery: palDelivery })
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

    const pal = prepareDailyLogPal({ learnerId: user.id, activityDay: date, occurredAt: now, text: entryText })
    const palEvent = pal.event
    if (pal.enabled) {
      try {
        const result = await upsertStudentEntryWithPalEvent({
          supabase,
          studentId: user.id,
          classroomId: classroom_id,
          date,
          text: entryText,
          richContent: content,
          onTime,
          expectedVersion: null,
          event: palEvent,
        })
        if (!result.ok) {
          return NextResponse.json(
            { error: result.error, entry: result.entry },
            { status: result.status },
          )
        }
        const palDelivery = palEvent || isClassroomPalRequested()
          ? await deliverDailyLogPal({ event: palEvent, supabase, membership: { studentId: user.id, classroomId: classroom_id } })
          : undefined
        return NextResponse.json({ entry: result.entry, pal_delivery: palDelivery })
      } catch (error) {
        console.error('Error creating entry with Pal outbox:', error)
        return NextResponse.json(
          { error: 'Failed to create entry' },
          { status: 500 }
        )
      }
    }

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
  if (rich_content && JSON.stringify(normalizeContent(rich_content, null)) === JSON.stringify(normalizeContent(existing.rich_content, existing.text))) {
    return NextResponse.json({ entry: existing })
  }
  if (!entry_id || entry_id !== existing.id) {
    return NextResponse.json(
      { error: 'Entry has been updated elsewhere', entry: existing },
      { status: 409 },
    )
  }
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
    const patched = tryApplyJsonPatch(baseContent, patch, { maxContentBytes: DAILY_LOG_MAX_WIRE_BYTES })
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

  const pal = prepareDailyLogPal({ learnerId: user.id, activityDay: date, occurredAt: now, text: entryText })
  const palEvent = pal.event
  if (pal.enabled) {
    try {
      const result = await upsertStudentEntryWithPalEvent({
        supabase,
        studentId: user.id,
        classroomId: classroom_id,
        date,
        text: entryText,
        richContent: nextContent,
        minutesReported: existing.minutes_reported,
        mood: existing.mood,
        onTime,
        expectedVersion: currentVersion,
        event: palEvent,
      })
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, entry: result.entry },
          { status: result.status },
        )
      }
      const palDelivery = palEvent || isClassroomPalRequested()
        ? await deliverDailyLogPal({ event: palEvent, supabase, membership: { studentId: user.id, classroomId: classroom_id } })
        : undefined
      return NextResponse.json({ entry: result.entry, pal_delivery: palDelivery })
    } catch (error) {
      console.error('Error updating entry with Pal outbox:', error)
      return NextResponse.json(
        { error: 'Failed to update entry' },
        { status: 500 },
      )
    }
  }

  const { data, error } = await supabase
    .from('entries')
    .update({
      text: entryText,
      rich_content: nextContent,
      on_time: onTime,
      version: nextVersion,
    })
    .eq('id', existing.id)
    .eq('version', currentVersion)
    .select()
    .maybeSingle()

  if (error) {
    console.error('Error updating entry:', error)
    return NextResponse.json(
      { error: 'Failed to update entry' },
      { status: 500 }
    )
  }

  if (!data) {
    const { data: latest } = await supabase
      .from('entries')
      .select('id, version, text, rich_content, minutes_reported, mood')
      .eq('id', existing.id)
      .maybeSingle()
    return NextResponse.json(
      { error: 'Entry has been updated elsewhere', entry: latest },
      { status: 409 },
    )
  }

  return NextResponse.json({ entry: data })
})
