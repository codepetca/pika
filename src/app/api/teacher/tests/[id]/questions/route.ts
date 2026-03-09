import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/questions - Add a question
export const POST = withErrorHandler('CreateTeacherTestQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const body = (await request.json()) as Record<string, unknown>

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const validation = validateTestQuestionCreate(body, {
    allowEmptyQuestionText: access.test.status === 'draft',
  })
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  const supabase = getServiceRoleClient()

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
      ...validation.value,
      position: nextPosition,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating test question:', error)
    return NextResponse.json({ error: 'Failed to create question' }, { status: 500 })
  }

  return NextResponse.json({ question }, { status: 201 })
})
