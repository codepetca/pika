import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { suggestTestOpenResponseGrade } from '@/lib/ai-test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/responses/[responseId]/ai-suggest
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId, responseId } = await params

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const supabase = getServiceRoleClient()
    const { data: responseRow, error: responseError } = await supabase
      .from('test_responses')
      .select(`
        id,
        test_id,
        question_id,
        response_text,
        test_questions!inner (
          id,
          question_type,
          question_text,
          points
        )
      `)
      .eq('id', responseId)
      .eq('test_id', testId)
      .single()

    if (responseError || !responseRow) {
      return NextResponse.json({ error: 'Response not found' }, { status: 404 })
    }

    const question = Array.isArray(responseRow.test_questions)
      ? responseRow.test_questions[0]
      : responseRow.test_questions
    if (!question || question.question_type !== 'open_response') {
      return NextResponse.json(
        { error: 'AI suggestions are only available for open-response answers' },
        { status: 400 }
      )
    }

    const responseText = typeof responseRow.response_text === 'string' ? responseRow.response_text.trim() : ''
    if (!responseText) {
      return NextResponse.json({ error: 'Response text is empty' }, { status: 400 })
    }

    const suggestion = await suggestTestOpenResponseGrade({
      testTitle: access.test.title,
      questionText: String(question.question_text || ''),
      responseText,
      maxPoints: Number(question.points ?? 0),
    })

    return NextResponse.json({
      suggestion,
      max_points: Number(question.points ?? 0),
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Generate AI test grade suggestion error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

