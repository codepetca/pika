import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateDailyLogSummary, hashDailyLogText } from '@/lib/daily-log-summaries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/logs?classroom_id=xxx&date=YYYY-MM-DD
 * Returns roster students with an optional entry for the selected date.
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

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format (use YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

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

    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('classroom_enrollments')
      .select(`
        student_id,
        users!classroom_enrollments_student_id_fkey(
          id,
          email
        )
      `)
      .eq('classroom_id', classroomId)

    if (enrollmentsError) {
      console.error('Error fetching enrollments:', enrollmentsError)
      return NextResponse.json(
        { error: 'Failed to fetch students' },
        { status: 500 }
      )
    }

    const students = (enrollments || [])
      .map(e => {
        const u = e.users as unknown as { id: string; email: string }
        return { id: u.id, email: u.email }
      })
      .sort((a, b) => a.email.localeCompare(b.email))

    let entriesQuery = supabase
      .from('entries')
      .select('*')
      .eq('classroom_id', classroomId)

    if (date) {
      entriesQuery = entriesQuery.eq('date', date)
    }

    const { data: entries, error: entriesError } = await entriesQuery

    if (entriesError) {
      console.error('Error fetching entries:', entriesError)
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      )
    }

    const entryByStudentId = new Map(
      (entries || []).map(entry => [entry.student_id, entry])
    )

    const entriesWithStudent = students
      .map(student => ({
        student,
        entry: entryByStudentId.get(student.id) || null,
      }))
      .filter((row): row is { student: { id: string; email: string }; entry: { id: string; text: string } } => Boolean(row.entry))

    const entryIds = entriesWithStudent.map(row => row.entry.id)
    const summaryByEntryId = new Map<string, { summary: string; model: string; text_hash: string }>()

    if (entryIds.length > 0) {
      const canGenerate = Boolean(process.env.OPENAI_API_KEY?.trim())

      const { data: existingSummaries, error: summariesError } = await supabase
        .from('entry_summaries')
        .select('entry_id, model, text_hash, summary')
        .in('entry_id', entryIds)

      if (summariesError) {
        console.error('Error fetching entry summaries:', summariesError)
        return NextResponse.json(
          { error: 'Failed to fetch summaries' },
          { status: 500 }
        )
      }

      for (const row of existingSummaries || []) {
        summaryByEntryId.set(row.entry_id, {
          summary: row.summary,
          model: row.model,
          text_hash: row.text_hash,
        })
      }

      const summariesToUpsert: Array<{ entry_id: string; model: string; text_hash: string; summary: string }> = []

      for (const { entry } of entriesWithStudent) {
        const textHash = hashDailyLogText(entry.text)
        const cached = summaryByEntryId.get(entry.id)
        if (cached && cached.text_hash === textHash) {
          continue
        }

        if (!canGenerate) {
          continue
        }

        const { summary, model } = await generateDailyLogSummary(entry.text)
        summaryByEntryId.set(entry.id, { summary, model, text_hash: textHash })
        summariesToUpsert.push({ entry_id: entry.id, model, text_hash: textHash, summary })
      }

      if (summariesToUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('entry_summaries')
          .upsert(summariesToUpsert, { onConflict: 'entry_id' })

        if (upsertError) {
          console.error('Error upserting entry summaries:', upsertError)
          return NextResponse.json(
            { error: 'Failed to store summaries' },
            { status: 500 }
          )
        }
      }
    }

    const logs = students.map(student => {
      const entry = entryByStudentId.get(student.id) || null
      const summaryRow = entry ? summaryByEntryId.get(entry.id) : null
      return {
        student_id: student.id,
        student_email: student.email,
        entry,
        summary: summaryRow ? summaryRow.summary : null,
      }
    })

    return NextResponse.json({
      classroom_id: classroomId,
      date: date || null,
      logs,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get teacher logs error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
