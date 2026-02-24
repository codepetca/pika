import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateQuizOptions } from '@/lib/quizzes'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/questions - Add a question
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params
    const body = await request.json()
    const { question_text, options } = body

    if (!question_text || !question_text.trim()) {
      return NextResponse.json({ error: 'Question text is required' }, { status: 400 })
    }

    if (!options || !Array.isArray(options)) {
      return NextResponse.json({ error: 'Options must be an array' }, { status: 400 })
    }

    const validation = validateQuizOptions(options)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    if (test.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot add questions to a test that is not in draft status' },
        { status: 400 }
      )
    }

    const { data: lastQuestion } = await supabase
      .from('test_questions')
      .select('position')
      .eq('test_id', testId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextPosition = typeof lastQuestion?.position === 'number' ? lastQuestion.position + 1 : 0

    const { data: question, error } = await supabase
      .from('test_questions')
      .insert({
        test_id: testId,
        question_text: question_text.trim(),
        options,
        position: nextPosition,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating test question:', error)
      return NextResponse.json({ error: 'Failed to create question' }, { status: 500 })
    }

    return NextResponse.json({ question }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Create test question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
