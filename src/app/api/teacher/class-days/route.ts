import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireAuth, requireRole } from '@/lib/auth'
import { generateClassDays, generateClassDaysFromRange } from '@/lib/calendar'
import { parse } from 'date-fns'
import type { Semester } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/class-days?classroom_id=xxx&semester=semester1&year=2024
 * Fetches class days for a classroom
 * Accessible by both teachers and students
 */
export async function GET(request: NextRequest) {
  try {
    // Allow both teachers and students to read class days
    await requireAuth()

    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const { data: classDays, error } = await supabase
      .from('class_days')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('date', { ascending: true })

    if (error) {
      console.error('Error fetching class days:', error)
      return NextResponse.json(
        { error: 'Failed to fetch class days' },
        { status: 500 }
      )
    }

    return NextResponse.json({ class_days: classDays || [] })
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
    console.error('Get class days error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/teacher/class-days
 * Generates class days for a classroom
 * Accepts either:
 * - { classroom_id, semester, year } for preset semesters
 * - { classroom_id, start_date, end_date } for custom date ranges
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')

    const body = await request.json()
    const { classroom_id, semester, year, start_date, end_date } = body

    // Validate input - either semester/year OR start_date/end_date
    const hasSemesterParams = semester && year
    const hasCustomParams = start_date && end_date

    if (!classroom_id || (!hasSemesterParams && !hasCustomParams)) {
      return NextResponse.json(
        { error: 'classroom_id and either (semester + year) or (start_date + end_date) are required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify classroom ownership
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', classroom_id)
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

    // Check if class days already exist
    const { data: existing } = await supabase
      .from('class_days')
      .select('id')
      .eq('classroom_id', classroom_id)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'Class days already exist for this classroom. Use PATCH to update.' },
        { status: 409 }
      )
    }

    // Generate class days based on input type
    let dates: string[]

    if (hasSemesterParams) {
      // Use semester preset
      dates = generateClassDays(semester as Semester, year)
    } else {
      // Use custom date range
      const startDate = parse(start_date, 'yyyy-MM-dd', new Date())
      const endDate = parse(end_date, 'yyyy-MM-dd', new Date())

      if (startDate >= endDate) {
        return NextResponse.json(
          { error: 'end_date must be after start_date' },
          { status: 400 }
        )
      }

      dates = generateClassDaysFromRange(startDate, endDate)
    }

    // Insert class days
    const classDayRecords = dates.map(date => ({
      classroom_id,
      date,
      is_class_day: true,
      prompt_text: null,
    }))

    const { data: created, error } = await supabase
      .from('class_days')
      .insert(classDayRecords)
      .select()

    if (error) {
      console.error('Error creating class days:', error)
      return NextResponse.json(
        { error: 'Failed to create class days' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      count: created.length,
      class_days: created,
    })
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
    console.error('Create class days error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/teacher/class-days
 * Toggles is_class_day for a specific date
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireRole('teacher')

    const body = await request.json()
    const { classroom_id, date, is_class_day } = body

    if (!classroom_id || !date || typeof is_class_day !== 'boolean') {
      return NextResponse.json(
        { error: 'classroom_id, date, and is_class_day are required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify classroom ownership
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', classroom_id)
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

    // Check if the class day exists
    const { data: existing } = await supabase
      .from('class_days')
      .select('id')
      .eq('classroom_id', classroom_id)
      .eq('date', date)
      .single()

    if (!existing) {
      // Create it if it doesn't exist
      const { data: created, error: createError } = await supabase
        .from('class_days')
        .insert({
          classroom_id,
          date,
          is_class_day,
          prompt_text: null,
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating class day:', createError)
        return NextResponse.json(
          { error: 'Failed to create class day' },
          { status: 500 }
        )
      }

      return NextResponse.json({ class_day: created })
    }

    // Update existing
    const { data: updated, error } = await supabase
      .from('class_days')
      .update({ is_class_day })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating class day:', error)
      return NextResponse.json(
        { error: 'Failed to update class day' },
        { status: 500 }
      )
    }

    return NextResponse.json({ class_day: updated })
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
    console.error('Update class day error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
