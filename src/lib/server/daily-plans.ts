import { getServiceRoleClient } from '@/lib/supabase'
import { getWeekDays, canStudentViewWeek, getCurrentWeekStart, getWeekStartForDate } from '@/lib/week-utils'
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns'
import type { DailyPlan, FuturePlansVisibility, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }

type FetchResult =
  | { ok: true; plans: Record<string, DailyPlan | null>; visibility: FuturePlansVisibility }
  | { ok: false; status: number; error: string }

/**
 * Fetches daily plans for a week.
 * For students, applies visibility filtering.
 * Returns a map of date -> plan (or null if no plan exists for that day).
 */
export async function fetchDailyPlansForWeek(args: {
  classroomId: string
  weekStart: string
  role: 'student' | 'teacher'
}): Promise<FetchResult> {
  const { classroomId, weekStart, role } = args
  const supabase = getServiceRoleClient()

  // Get classroom visibility setting
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('future_plans_visibility')
    .eq('id', classroomId)
    .single()

  if (classroomError || !classroom) {
    return { ok: false, status: 404, error: 'Classroom not found' }
  }

  const visibility = classroom.future_plans_visibility as FuturePlansVisibility

  // For students, check visibility
  if (role === 'student') {
    const currentWeekStart = getCurrentWeekStart()
    if (!canStudentViewWeek(weekStart, visibility, currentWeekStart)) {
      return { ok: false, status: 403, error: 'Week not visible to students' }
    }
  }

  // Fetch plans for the week
  const weekDays = getWeekDays(weekStart)
  const { data: plans, error: plansError } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('classroom_id', classroomId)
    .in('date', weekDays)

  if (plansError) {
    return { ok: false, status: 500, error: 'Failed to fetch daily plans' }
  }

  // Build map of date -> plan
  const plansByDate: Record<string, DailyPlan | null> = {}
  for (const date of weekDays) {
    const plan = plans?.find(p => p.date === date) || null
    plansByDate[date] = plan
  }

  return { ok: true, plans: plansByDate, visibility }
}

type UpsertResult =
  | { ok: true; plan: DailyPlan }
  | { ok: false; status: number; error: string }

/**
 * Upserts a daily plan for a specific date.
 * Creates a new plan if one doesn't exist, otherwise updates the existing one.
 */
export async function upsertDailyPlan(args: {
  classroomId: string
  date: string
  richContent: TiptapContent
}): Promise<UpsertResult> {
  const { classroomId, date, richContent } = args
  const supabase = getServiceRoleClient()

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(date)) {
    return { ok: false, status: 400, error: 'Invalid date format (use YYYY-MM-DD)' }
  }

  // Check if plan exists
  const { data: existing } = await supabase
    .from('daily_plans')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .single()

  if (!existing) {
    // Create new plan
    const { data: created, error: createError } = await supabase
      .from('daily_plans')
      .insert({
        classroom_id: classroomId,
        date,
        rich_content: richContent,
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating daily plan:', createError)
      return { ok: false, status: 500, error: 'Failed to create daily plan' }
    }

    return { ok: true, plan: created as DailyPlan }
  }

  // Update existing plan
  const { data: updated, error: updateError } = await supabase
    .from('daily_plans')
    .update({
      rich_content: richContent,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select()
    .single()

  if (updateError) {
    console.error('Error updating daily plan:', updateError)
    return { ok: false, status: 500, error: 'Failed to update daily plan' }
  }

  return { ok: true, plan: updated as DailyPlan }
}

type VisibilityUpdateResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * Updates the future_plans_visibility setting for a classroom.
 */
export async function updatePlansVisibility(args: {
  classroomId: string
  visibility: FuturePlansVisibility
}): Promise<VisibilityUpdateResult> {
  const { classroomId, visibility } = args
  const supabase = getServiceRoleClient()

  const validValues: FuturePlansVisibility[] = ['current', 'next', 'all']
  if (!validValues.includes(visibility)) {
    return { ok: false, status: 400, error: 'Invalid visibility value' }
  }

  const { error } = await supabase
    .from('classrooms')
    .update({ future_plans_visibility: visibility })
    .eq('id', classroomId)

  if (error) {
    console.error('Error updating visibility:', error)
    return { ok: false, status: 500, error: 'Failed to update visibility' }
  }

  return { ok: true }
}

type DatesWithPlansResult =
  | { ok: true; dates: string[] }
  | { ok: false; status: number; error: string }

/**
 * Fetches all dates that have plans within a month.
 * Used for calendar dot indicators.
 */
export async function fetchDatesWithPlans(args: {
  classroomId: string
  month: string // YYYY-MM
}): Promise<DatesWithPlansResult> {
  const { classroomId, month } = args
  const supabase = getServiceRoleClient()

  // Validate month format
  const monthRegex = /^\d{4}-\d{2}$/
  if (!monthRegex.test(month)) {
    return { ok: false, status: 400, error: 'Invalid month format (use YYYY-MM)' }
  }

  // Get month boundaries
  const monthDate = parseISO(`${month}-01`)
  const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd')

  const { data: plans, error } = await supabase
    .from('daily_plans')
    .select('date')
    .eq('classroom_id', classroomId)
    .gte('date', monthStart)
    .lte('date', monthEnd)

  if (error) {
    console.error('Error fetching dates with plans:', error)
    return { ok: false, status: 500, error: 'Failed to fetch dates' }
  }

  const dates = plans?.map(p => p.date) || []
  return { ok: true, dates }
}

type SinglePlanResult =
  | { ok: true; plan: DailyPlan | null; visibility: FuturePlansVisibility }
  | { ok: false; status: number; error: string }

/**
 * Fetches a single daily plan for a specific date.
 * For students, applies visibility filtering.
 */
export async function fetchDailyPlanForDate(args: {
  classroomId: string
  date: string
  role: 'student' | 'teacher'
}): Promise<SinglePlanResult> {
  const { classroomId, date, role } = args
  const supabase = getServiceRoleClient()

  // Get classroom visibility setting
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('future_plans_visibility')
    .eq('id', classroomId)
    .single()

  if (classroomError || !classroom) {
    return { ok: false, status: 404, error: 'Classroom not found' }
  }

  const visibility = classroom.future_plans_visibility as FuturePlansVisibility

  // For students, check visibility
  if (role === 'student') {
    const weekStart = getWeekStartForDate(date)
    const currentWeekStart = getCurrentWeekStart()
    if (!canStudentViewWeek(weekStart, visibility, currentWeekStart)) {
      return { ok: false, status: 403, error: 'Date not visible to students' }
    }
  }

  const { data: plan, error: planError } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .single()

  if (planError && planError.code !== 'PGRST116') {
    // PGRST116 = not found, which is ok
    return { ok: false, status: 500, error: 'Failed to fetch daily plan' }
  }

  return { ok: true, plan: plan || null, visibility }
}
