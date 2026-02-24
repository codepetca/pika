import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/tests/[id]/respond - Submit all responses
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: testId } = await params
    const body = await request.json()
    const { responses } = body

    if (!responses || typeof responses !== 'object') {
      return NextResponse.json({ error: 'Responses are required' }, { status: 400 })
    }

    const access = await assertStudentCanAccessTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    if (test.status !== 'active') {
      return NextResponse.json({ error: 'Test is not active' }, { status: 400 })
    }

    const { data: existingResponses } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    if ((existingResponses?.length || 0) > 0) {
      return NextResponse.json({ error: 'You have already responded to this test' }, { status: 400 })
    }

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('id, options')
      .eq('test_id', testId)

    if (questionsError || !questions) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    const questionIds = questions.map((q) => q.id)
    const responseQuestionIds = Object.keys(responses)

    const missingQuestions = questionIds.filter((qid) => !responseQuestionIds.includes(qid))
    if (missingQuestions.length > 0) {
      return NextResponse.json({ error: 'All questions must be answered' }, { status: 400 })
    }

    const questionsMap = new Map(questions.map((q) => [q.id, q.options]))
    for (const [questionId, selectedOption] of Object.entries(responses)) {
      const options = questionsMap.get(questionId)
      if (!options) {
        return NextResponse.json({ error: `Invalid question ID: ${questionId}` }, { status: 400 })
      }
      if (typeof selectedOption !== 'number' || !Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= options.length) {
        return NextResponse.json(
          { error: `Invalid option for question ${questionId}` },
          { status: 400 }
        )
      }
    }

    const responsesToInsert = Object.entries(responses).map(([questionId, selectedOption]) => ({
      test_id: testId,
      question_id: questionId,
      student_id: user.id,
      selected_option: selectedOption as number,
    }))

    const { error: insertError } = await supabase
      .from('test_responses')
      .insert(responsesToInsert)

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'You have already responded to this test' }, { status: 400 })
      }
      console.error('Error inserting test responses:', insertError)
      return NextResponse.json({ error: 'Failed to submit responses' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Submit test response error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
