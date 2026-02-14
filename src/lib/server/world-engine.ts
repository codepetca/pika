import { addDays, parseISO, subDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getServiceRoleClient } from '@/lib/supabase'
import { BASE_XP, WEEKLY_BONUS_XP, WEEKLY_TRACK_POINTS, TRACK_POINTS_PER_LEVEL, resolveWeeklyTier, scoreAttendanceRatio, scoreDailyCareConsistency, scoreOnTimeSubmissions, summarizeWeeklyBuckets } from '@/lib/world-scoring'
import { DAILY_CARE_EVENT_KEYS, DAILY_SPAWN_HOUR_TORONTO, DAILY_SPAWN_MINUTE_TORONTO, WORLD_TIMEZONE, WEEKLY_EVAL_DAY_TORONTO, WEEKLY_EVAL_HOUR_TORONTO, WEEKLY_EVAL_MINUTE_TORONTO, type WeeklyTier } from '@/lib/world-rules'
import { calculateLevel, detectNewUnlocks, enrichPetState } from '@/lib/pet'
import type { StudentWorldSnapshot, UserPet, WorldDailyEvent, WorldEventCatalogItem, WorldWeeklyResult } from '@/types'

type WorldResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

function torontoDateString(date: Date): string {
  return formatInTimeZone(date, WORLD_TIMEZONE, 'yyyy-MM-dd')
}

function buildTorontoWallClock(dateString: string, hour: number, minute: number): Date {
  const base = parseISO(`${dateString}T00:00:00`)
  const local = new Date(base)
  local.setHours(hour, minute, 0, 0)
  return fromZonedTime(local, WORLD_TIMEZONE)
}

function tomorrowDateString(dateString: string): string {
  return torontoDateString(addDays(parseISO(`${dateString}T00:00:00`), 1))
}

function yesterdayDateString(dateString: string): string {
  return torontoDateString(subDays(parseISO(`${dateString}T00:00:00`), 1))
}

function nextDailySpawnAt(now: Date): string {
  const today = torontoDateString(now)
  const spawnToday = buildTorontoWallClock(today, DAILY_SPAWN_HOUR_TORONTO, DAILY_SPAWN_MINUTE_TORONTO)
  if (spawnToday.getTime() > now.getTime()) {
    return spawnToday.toISOString()
  }
  const tomorrow = tomorrowDateString(today)
  return buildTorontoWallClock(tomorrow, DAILY_SPAWN_HOUR_TORONTO, DAILY_SPAWN_MINUTE_TORONTO).toISOString()
}

function nextWeeklyEvalAt(now: Date): string {
  let cursor = new Date(now)
  for (let i = 0; i < 8; i++) {
    const day = Number(formatInTimeZone(cursor, WORLD_TIMEZONE, 'i')) % 7 // convert 1-7 ISO -> 1-0 JS-like
    const jsDay = day === 0 ? 0 : day
    const date = torontoDateString(cursor)
    const wall = buildTorontoWallClock(date, WEEKLY_EVAL_HOUR_TORONTO, WEEKLY_EVAL_MINUTE_TORONTO)
    if (jsDay === WEEKLY_EVAL_DAY_TORONTO && wall.getTime() > now.getTime()) {
      return wall.toISOString()
    }
    cursor = addDays(cursor, 1)
  }
  const fallback = torontoDateString(addDays(now, 7))
  return buildTorontoWallClock(fallback, WEEKLY_EVAL_HOUR_TORONTO, WEEKLY_EVAL_MINUTE_TORONTO).toISOString()
}

function careEventKeyForDate(dateString: string): string {
  const dayNumber = parseISO(`${dateString}T00:00:00`).getTime() / (1000 * 60 * 60 * 24)
  const idx = Math.abs(Math.floor(dayNumber)) % DAILY_CARE_EVENT_KEYS.length
  return DAILY_CARE_EVENT_KEYS[idx]
}

function eraForTrackLevel(trackLevel: number): string {
  if (trackLevel >= 6) return 'observatory'
  if (trackLevel >= 4) return 'village'
  if (trackLevel >= 2) return 'garden'
  return 'seed'
}

async function getOrCreateWorldPet(userId: string, classroomId: string): Promise<WorldResult<UserPet>> {
  const supabase = getServiceRoleClient()
  const { data: existing, error } = await supabase
    .from('user_pets')
    .select('*')
    .eq('user_id', userId)
    .eq('classroom_id', classroomId)
    .single()

  if (existing) {
    return { ok: true, data: existing as UserPet }
  }
  if (error && error.code !== 'PGRST116') {
    console.error('world:getOrCreate fetch error', error)
    return { ok: false, status: 500, error: 'Failed to fetch world' }
  }

  const now = new Date()
  const { data: created, error: insertError } = await supabase
    .from('user_pets')
    .insert({
      user_id: userId,
      classroom_id: classroomId,
      next_daily_spawn_at: nextDailySpawnAt(now),
      next_weekly_eval_at: nextWeeklyEvalAt(now),
    })
    .select('*')
    .single()

  if (insertError || !created) {
    if (insertError?.code === '23505') {
      const { data: raced } = await supabase
        .from('user_pets')
        .select('*')
        .eq('user_id', userId)
        .eq('classroom_id', classroomId)
        .single()
      if (raced) return { ok: true, data: raced as UserPet }
    }
    console.error('world:getOrCreate insert error', insertError)
    return { ok: false, status: 500, error: 'Failed to create world' }
  }

  await supabase.from('pet_unlocks').insert({ pet_id: created.id, image_index: 0 })
  return { ok: true, data: created as UserPet }
}

async function awardXpInternal(
  pet: UserPet,
  source: string,
  xpAmount: number,
  metadata: Record<string, any> | null = null
): Promise<{ totalXp: number; newLevel: number; newUnlocks: number[] }> {
  const supabase = getServiceRoleClient()

  await supabase.from('xp_events').insert({
    pet_id: pet.id,
    source,
    xp_amount: xpAmount,
    metadata,
  })

  const currentXp = pet.xp ?? 0
  const updatedXp = currentXp + xpAmount
  const { error: updateError } = await supabase
    .from('user_pets')
    .update({ xp: updatedXp })
    .eq('id', pet.id)
  if (updateError) {
    console.error('world:award xp update error', updateError)
  }

  const { data: unlockRows } = await supabase
    .from('pet_unlocks')
    .select('image_index')
    .eq('pet_id', pet.id)

  const existing = (unlockRows || []).map((u: any) => u.image_index as number)
  const newLevel = calculateLevel(updatedXp)
  const newUnlocks = detectNewUnlocks(existing, newLevel)
  if (newUnlocks.length > 0) {
    await supabase
      .from('pet_unlocks')
      .insert(newUnlocks.map((imageIndex) => ({ pet_id: pet.id, image_index: imageIndex })))
  }

  return { totalXp: xpAmount, newLevel, newUnlocks }
}

export async function getWorldSnapshot(userId: string, classroomId: string): Promise<WorldResult<StudentWorldSnapshot>> {
  const petResult = await getOrCreateWorldPet(userId, classroomId)
  if (!petResult.ok) return petResult

  const supabase = getServiceRoleClient()
  const pet = petResult.data
  const now = new Date()

  if (!pet.next_daily_spawn_at || !pet.next_weekly_eval_at) {
    await supabase
      .from('user_pets')
      .update({
        next_daily_spawn_at: pet.next_daily_spawn_at || nextDailySpawnAt(now),
        next_weekly_eval_at: pet.next_weekly_eval_at || nextWeeklyEvalAt(now),
      })
      .eq('id', pet.id)
  }

  const { data: unlocks } = await supabase
    .from('pet_unlocks')
    .select('*')
    .eq('pet_id', pet.id)
    .order('image_index', { ascending: true })

  const today = torontoDateString(now)
  const { data: dailyEvent } = await supabase
    .from('world_daily_events')
    .select('*')
    .eq('pet_id', pet.id)
    .eq('event_day', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: weekly } = await supabase
    .from('world_weekly_results')
    .select('*')
    .eq('pet_id', pet.id)
    .order('eval_week_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  const state = enrichPetState({ ...pet }, (unlocks || []) as any[]) as any
  state.overlay_enabled = pet.overlay_enabled ?? true
  state.streak_days = pet.streak_days ?? 0
  state.last_login_day = pet.last_login_day ?? null
  state.season_start = pet.season_start ?? null
  state.season_end = pet.season_end ?? null
  state.next_daily_spawn_at = pet.next_daily_spawn_at ?? null
  state.next_weekly_eval_at = pet.next_weekly_eval_at ?? null
  state.weekly_track_level = pet.weekly_track_level ?? 0
  state.weekly_track_points = pet.weekly_track_points ?? 0

  return {
    ok: true,
    data: {
      world: state,
      dailyEvent: (dailyEvent || null) as WorldDailyEvent | null,
      latestWeeklyResult: (weekly || null) as WorldWeeklyResult | null,
    },
  }
}

export async function setOverlayEnabled(
  userId: string,
  classroomId: string,
  enabled: boolean
): Promise<WorldResult<{ overlayEnabled: boolean }>> {
  const petResult = await getOrCreateWorldPet(userId, classroomId)
  if (!petResult.ok) return petResult
  const supabase = getServiceRoleClient()
  const { error } = await supabase
    .from('user_pets')
    .update({ overlay_enabled: enabled })
    .eq('id', petResult.data.id)
  if (error) {
    console.error('world:set overlay error', error)
    return { ok: false, status: 500, error: 'Failed to update world preference' }
  }
  return { ok: true, data: { overlayEnabled: enabled } }
}

export async function claimDailyCareEvent(
  userId: string,
  classroomId: string
): Promise<WorldResult<{ event: WorldDailyEvent | null; xpAwarded: number; newLevel: number; newUnlocks: number[] }>> {
  const petResult = await getOrCreateWorldPet(userId, classroomId)
  if (!petResult.ok) return petResult

  const pet = petResult.data
  const supabase = getServiceRoleClient()
  const now = new Date()
  const today = torontoDateString(now)

  const { data: event } = await supabase
    .from('world_daily_events')
    .select('*')
    .eq('pet_id', pet.id)
    .eq('event_day', today)
    .eq('status', 'claimable')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!event) {
    return { ok: true, data: { event: null, xpAwarded: 0, newLevel: calculateLevel(pet.xp ?? 0), newUnlocks: [] } }
  }
  if (new Date(event.claimable_until).getTime() < now.getTime()) {
    await supabase.from('world_daily_events').update({ status: 'expired' }).eq('id', event.id)
    return { ok: true, data: { event: null, xpAwarded: 0, newLevel: calculateLevel(pet.xp ?? 0), newUnlocks: [] } }
  }

  const { error: updateError } = await supabase
    .from('world_daily_events')
    .update({ status: 'claimed', claimed_at: now.toISOString() })
    .eq('id', event.id)
    .eq('status', 'claimable')
  if (updateError) {
    console.error('world:claim daily update error', updateError)
  }

  const xp = await awardXpInternal(pet, 'daily_care_claimed', BASE_XP.daily_care_claimed, {
    event_id: event.id,
    event_key: event.event_key,
  })

  return {
    ok: true,
    data: {
      event: { ...event, status: 'claimed', claimed_at: now.toISOString() } as WorldDailyEvent,
      xpAwarded: xp.totalXp,
      newLevel: xp.newLevel,
      newUnlocks: xp.newUnlocks,
    },
  }
}

async function touchDailySpawnForPet(pet: UserPet, now: Date): Promise<void> {
  const supabase = getServiceRoleClient()
  const today = torontoDateString(now)
  const tomorrow = tomorrowDateString(today)
  const claimableUntil = buildTorontoWallClock(tomorrow, 0, 0).toISOString()

  const { data: existing } = await supabase
    .from('world_daily_events')
    .select('id')
    .eq('pet_id', pet.id)
    .eq('event_day', today)
    .maybeSingle()

  if (!existing) {
    const eventKey = careEventKeyForDate(today)
    await supabase.from('world_daily_events').insert({
      pet_id: pet.id,
      event_day: today,
      event_key: eventKey,
      status: 'claimable',
      claimable_until: claimableUntil,
    })
  }

  await supabase
    .from('user_pets')
    .update({
      next_daily_spawn_at: buildTorontoWallClock(tomorrow, DAILY_SPAWN_HOUR_TORONTO, DAILY_SPAWN_MINUTE_TORONTO).toISOString(),
    })
    .eq('id', pet.id)
}

export async function awardAttendanceForDate(
  userId: string,
  classroomId: string,
  date: string
): Promise<void> {
  const petResult = await getOrCreateWorldPet(userId, classroomId)
  if (!petResult.ok) return
  const pet = petResult.data
  const supabase = getServiceRoleClient()

  const rewardKey = `attendance:${date}`
  const { error: rewardError } = await supabase.from('pet_rewards').insert({
    pet_id: pet.id,
    reward_type: 'world_attendance_present',
    reward_key: rewardKey,
    metadata: { date },
  })

  if (rewardError) {
    if (rewardError.code !== '23505') {
      console.error('world:attendance reward error', rewardError)
    }
    return
  }

  await awardXpInternal(pet, 'attendance_present', BASE_XP.attendance_present, { date })
}

export async function awardAssignmentSubmission(
  userId: string,
  classroomId: string,
  assignmentId: string,
  onTime: boolean
): Promise<WorldResult<{ xpAwarded: number; newLevel: number; newUnlocks: number[]; source: string }>> {
  const petResult = await getOrCreateWorldPet(userId, classroomId)
  if (!petResult.ok) return petResult
  const pet = petResult.data
  const supabase = getServiceRoleClient()

  const rewardType = onTime ? 'world_assignment_submitted_on_time' : 'world_assignment_submitted_late'
  const rewardKey = `assignment:${assignmentId}`
  const { error: rewardError } = await supabase.from('pet_rewards').insert({
    pet_id: pet.id,
    reward_type: rewardType,
    reward_key: rewardKey,
    metadata: { assignmentId, onTime },
  })
  if (rewardError) {
    if (rewardError.code === '23505') {
      return {
        ok: true,
        data: {
          xpAwarded: 0,
          newLevel: calculateLevel(pet.xp ?? 0),
          newUnlocks: [],
          source: onTime ? 'assignment_submitted_on_time' : 'assignment_submitted_late',
        },
      }
    }
    console.error('world:assignment reward error', rewardError)
    return { ok: false, status: 500, error: 'Failed to grant assignment reward' }
  }

  const source = onTime ? 'assignment_submitted_on_time' : 'assignment_submitted_late'
  const xp = await awardXpInternal(
    pet,
    source,
    onTime ? BASE_XP.assignment_submitted_on_time : BASE_XP.assignment_submitted_late,
    { assignmentId, onTime }
  )
  return { ok: true, data: { xpAwarded: xp.totalXp, newLevel: xp.newLevel, newUnlocks: xp.newUnlocks, source } }
}

export async function processLoginStreakForAllClassrooms(userId: string): Promise<void> {
  const supabase = getServiceRoleClient()
  const { data: enrollments, error } = await supabase
    .from('classroom_enrollments')
    .select('classroom_id')
    .eq('student_id', userId)
  if (error || !enrollments) {
    if (error) console.error('world:login streak enrollment error', error)
    return
  }

  const today = torontoDateString(new Date())
  const yesterday = yesterdayDateString(today)

  for (const enrollment of enrollments) {
    const classroomId = enrollment.classroom_id as string
    const petResult = await getOrCreateWorldPet(userId, classroomId)
    if (!petResult.ok) continue
    const pet = petResult.data

    const lastLogin = pet.last_login_day ?? null
    if (lastLogin === today) continue

    const streakDays = lastLogin === yesterday ? (pet.streak_days ?? 0) + 1 : 1
    await supabase
      .from('user_pets')
      .update({ last_login_day: today, streak_days: streakDays })
      .eq('id', pet.id)

    if (streakDays >= 3) {
      await supabase.from('pet_rewards').insert({
        pet_id: pet.id,
        reward_type: 'companion.pika_unlocked',
        reward_key: 'streak_3',
      })
    }
  }
}

function getTorontoWeekWindow(now: Date): { start: string; end: string } {
  const today = parseISO(`${torontoDateString(now)}T00:00:00`)
  const day = Number(formatInTimeZone(now, WORLD_TIMEZONE, 'i')) // 1..7
  const daysFromFriday = (day + 2) % 7 // if Friday (5) =>0, Sat=>1...
  const end = subDays(today, daysFromFriday)
  const start = subDays(end, 6)
  return { start: torontoDateString(start), end: torontoDateString(end) }
}

async function pickWeeklyEventKey(
  petId: string,
  tier: WeeklyTier,
  trackLevel: number
): Promise<string | null> {
  const supabase = getServiceRoleClient()
  const era = eraForTrackLevel(trackLevel)

  const { data: catalogRows } = await supabase
    .from('world_event_catalog')
    .select('*')
    .eq('category', 'weekly_episode')
    .eq('tier', tier)
    .eq('active', true)

  const rows = ((catalogRows || []) as WorldEventCatalogItem[]).filter((row) => {
    const allowedEras = ['seed', 'garden', 'village', 'observatory']
    return allowedEras.indexOf(row.era_min) <= allowedEras.indexOf(era)
  })
  if (rows.length === 0) return null

  const { data: recent } = await supabase
    .from('world_weekly_results')
    .select('event_key')
    .eq('pet_id', petId)
    .order('eval_week_start', { ascending: false })
    .limit(8)

  const recentKeys = (recent || []).map((r: any) => r.event_key).filter(Boolean)
  const filtered = rows.filter((row) => !recentKeys.slice(0, row.cooldown_weeks).includes(row.key))
  const pool = filtered.length > 0 ? filtered : rows
  const totalWeight = pool.reduce((sum, row) => sum + row.weight, 0)
  let pick = Math.random() * Math.max(totalWeight, 1)
  for (const row of pool) {
    pick -= row.weight
    if (pick <= 0) return row.key
  }
  return pool[pool.length - 1]?.key || null
}

async function runWeeklyEvaluationForPet(pet: UserPet, now: Date): Promise<void> {
  const supabase = getServiceRoleClient()
  const { start, end } = getTorontoWeekWindow(now)

  const { data: existing } = await supabase
    .from('world_weekly_results')
    .select('id')
    .eq('pet_id', pet.id)
    .eq('eval_week_start', start)
    .maybeSingle()
  if (existing) {
    await supabase
      .from('user_pets')
      .update({ next_weekly_eval_at: nextWeeklyEvalAt(now) })
      .eq('id', pet.id)
    return
  }

  const { data: classDays } = await supabase
    .from('class_days')
    .select('date')
    .eq('classroom_id', pet.classroom_id)
    .eq('is_class_day', true)
    .gte('date', start)
    .lte('date', end)

  const y = (classDays || []).length
  const { data: entries } = await supabase
    .from('entries')
    .select('date')
    .eq('student_id', pet.user_id)
    .eq('classroom_id', pet.classroom_id)
    .gte('date', start)
    .lte('date', end)
  const x = new Set((entries || []).map((e: any) => e.date)).size

  const { data: assignments } = await supabase
    .from('assignments')
    .select('id, due_at')
    .eq('classroom_id', pet.classroom_id)
    .gte('due_at', `${start}T00:00:00.000Z`)
    .lte('due_at', `${end}T23:59:59.999Z`)

  const assignmentIds = (assignments || []).map((a: any) => a.id as string)
  let onTimeCount = 0
  if (assignmentIds.length > 0) {
    const { data: docs } = await supabase
      .from('assignment_docs')
      .select('assignment_id, is_submitted, submitted_at')
      .eq('student_id', pet.user_id)
      .in('assignment_id', assignmentIds)

    const dueMap = new Map((assignments || []).map((a: any) => [a.id as string, new Date(a.due_at as string).getTime()]))
    for (const doc of docs || []) {
      if (!doc.is_submitted || !doc.submitted_at) continue
      const dueAt = dueMap.get(doc.assignment_id as string)
      if (!dueAt) continue
      if (new Date(doc.submitted_at as string).getTime() <= dueAt) {
        onTimeCount += 1
      }
    }
  }

  const { data: careEvents } = await supabase
    .from('world_daily_events')
    .select('status')
    .eq('pet_id', pet.id)
    .gte('event_day', start)
    .lte('event_day', end)

  const eligibleDays = (careEvents || []).length
  const claimedDays = (careEvents || []).filter((event: any) => event.status === 'claimed').length

  const attendancePoints = y > 0 ? scoreAttendanceRatio(x / y) : undefined
  const assignmentPoints = assignmentIds.length > 0 ? scoreOnTimeSubmissions(onTimeCount) : undefined
  const carePoints = eligibleDays > 0 ? scoreDailyCareConsistency(claimedDays / eligibleDays) : undefined

  const summary = summarizeWeeklyBuckets({
    attendance: attendancePoints,
    assignment: assignmentPoints,
    care: carePoints,
  })
  const tier = resolveWeeklyTier(summary.weeklyPct, summary.enabledBucketCount)
  const eventKey = await pickWeeklyEventKey(pet.id, tier, pet.weekly_track_level ?? 0)
  const bonusXp = WEEKLY_BONUS_XP[tier]
  const trackPointsAwarded = WEEKLY_TRACK_POINTS[tier]

  const xpResult = await awardXpInternal(pet, 'weekly_bonus', bonusXp, {
    eval_week_start: start,
    eval_week_end: end,
    tier,
  })

  const trackBefore = pet.weekly_track_points ?? 0
  const totalTrackPoints = trackBefore + trackPointsAwarded
  const levelsGained = Math.floor(totalTrackPoints / TRACK_POINTS_PER_LEVEL)
  const trackRollover = totalTrackPoints % TRACK_POINTS_PER_LEVEL

  await supabase
    .from('user_pets')
    .update({
      weekly_track_level: (pet.weekly_track_level ?? 0) + levelsGained,
      weekly_track_points: trackRollover,
      next_weekly_eval_at: nextWeeklyEvalAt(now),
    })
    .eq('id', pet.id)

  await supabase
    .from('world_weekly_results')
    .insert({
      pet_id: pet.id,
      eval_week_start: start,
      eval_week_end: end,
      attendance_points: summary.attendancePoints,
      assignment_points: summary.assignmentPoints,
      care_points: summary.carePoints,
      earned_points: summary.earnedPoints,
      available_points: summary.availablePoints,
      weekly_pct: summary.weeklyPct,
      tier,
      event_key: eventKey,
      bonus_xp: bonusXp,
      track_points_awarded: trackPointsAwarded,
      details: {
        attended_days: x,
        scheduled_days: y,
        on_time_submissions: onTimeCount,
        due_assignments: assignmentIds.length,
        claimed_care_days: claimedDays,
        eligible_care_days: eligibleDays,
        new_level: xpResult.newLevel,
        new_unlocks: xpResult.newUnlocks,
      },
    })
}

export async function runWorldCadenceTick(): Promise<{ dailySpawned: number; expired: number; weeklyEvaluated: number }> {
  const supabase = getServiceRoleClient()
  const now = new Date()
  let dailySpawned = 0
  let expired = 0
  let weeklyEvaluated = 0

  const { data: dueDaily } = await supabase
    .from('user_pets')
    .select('*')
    .or(`next_daily_spawn_at.lte.${now.toISOString()},next_daily_spawn_at.is.null`)
    .limit(500)

  for (const pet of (dueDaily || []) as UserPet[]) {
    await touchDailySpawnForPet(pet, now)
    dailySpawned += 1
  }

  const today = torontoDateString(now)
  const { data: expiring } = await supabase
    .from('world_daily_events')
    .select('id')
    .eq('status', 'claimable')
    .lt('event_day', today)
    .limit(1000)

  if ((expiring || []).length > 0) {
    const ids = (expiring || []).map((row: any) => row.id)
    const { error } = await supabase
      .from('world_daily_events')
      .update({ status: 'expired' })
      .in('id', ids)
    if (!error) {
      expired = ids.length
    }
  }

  const { data: dueWeekly } = await supabase
    .from('user_pets')
    .select('*')
    .or(`next_weekly_eval_at.lte.${now.toISOString()},next_weekly_eval_at.is.null`)
    .limit(500)

  for (const pet of (dueWeekly || []) as UserPet[]) {
    await runWeeklyEvaluationForPet(pet, now)
    weeklyEvaluated += 1
  }

  return { dailySpawned, expired, weeklyEvaluated }
}

