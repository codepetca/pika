import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { isOnTime } from '@/lib/timezone'
import { getTodayInToronto } from '@/lib/timezone'
import type { MoodEmoji } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/student/entries?classroom_id=xxx
 * Fetches all entries for the current student
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const supabase = getServiceRoleClient()

    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    let query = supabase
      .from('entries')
      .select('*')
      .eq('student_id', user.id)
      .order('date', { ascending: false })

    if (classroomId) {
      query = query.eq('classroom_id', classroomId)
    }

    const { data: entries, error } = await query

    if (error) {
      console.error('Error fetching entries:', error)
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      )
    }

    return NextResponse.json({ entries })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
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
    const body = await request.json()

    const { classroom_id, date, text, minutes_reported, mood } = body

    // Validation
    if (!classroom_id || !date || !text) {
      return NextResponse.json(
        { error: 'classroom_id, date, and text are required' },
        { status: 400 }
      )
    }

    if (text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Entry text cannot be empty' },
        { status: 400 }
      )
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format (use YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    // Validate mood if provided
    const validMoods: MoodEmoji[] = ['😊', '🙂', '😐']
    if (mood && !validMoods.includes(mood)) {
      return NextResponse.json(
        { error: 'Invalid mood value' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify student is enrolled in classroom
    const { data: enrollment, error: enrollError } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', classroom_id)
      .eq('student_id', user.id)
      .single()

    if (enrollError || !enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }

    const todayToronto = getTodayInToronto()
    if (date > todayToronto) {
      return NextResponse.json(
        { error: 'Cannot submit entries for future dates' },
        { status: 400 }
      )
    }

    // Students can only log on dates that are explicitly marked as class days.
    const { data: classDay, error: classDayError } = await supabase
      .from('class_days')
      .select('is_class_day')
      .eq('classroom_id', classroom_id)
      .eq('date', date)
      .single()

    if (classDayError && classDayError.code !== 'PGRST116') {
      console.error('Error fetching class day:', classDayError)
      return NextResponse.json(
        { error: 'Failed to validate class day' },
        { status: 500 }
      )
    }

    if (!classDay?.is_class_day) {
      return NextResponse.json(
        { error: 'Not a class day' },
        { status: 400 }
      )
    }

    // Calculate on_time status
    const now = new Date()
    const onTime = isOnTime(now, date)

    // Check if entry already exists
    const { data: existing } = await supabase
      .from('entries')
      .select('id')
      .eq('student_id', user.id)
      .eq('classroom_id', classroom_id)
      .eq('date', date)
      .single()

    let entry

    if (existing) {
      // Update existing entry
      const { data, error } = await supabase
        .from('entries')
        .update({
          text,
          minutes_reported,
          mood,
          on_time: onTime, // Recalculate on update
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
      // Create new entry
      const { data, error } = await supabase
        .from('entries')
        .insert({
          student_id: user.id,
          classroom_id,
          date,
          text,
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
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Create/update entry error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
