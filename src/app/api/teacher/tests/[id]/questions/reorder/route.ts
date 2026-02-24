import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/questions/reorder
// body: { question_ids: string[] }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params
    const body = await request.json()
    const { question_ids } = body as { question_ids?: string[] }

    if (!Array.isArray(question_ids)) {
      return NextResponse.json({ error: 'question_ids is required' }, { status: 400 })
    }

    if (question_ids.some((id: unknown) => typeof id !== 'string' || !id)) {
      return NextResponse.json({ error: 'question_ids must be non-empty strings' }, { status: 400 })
    }

    const uniqueIds = Array.from(new Set(question_ids))
    if (uniqueIds.length !== question_ids.length) {
      return NextResponse.json({ error: 'question_ids must be unique' }, { status: 400 })
    }

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    if (access.test.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot reorder questions on a test that is not in draft status' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('id')
      .eq('test_id', testId)

    if (questionsError) {
      console.error('Error verifying test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to verify questions' }, { status: 500 })
    }

    const existingIds = new Set((questions || []).map((q) => q.id))
    if (uniqueIds.length !== existingIds.size || !uniqueIds.every((id) => existingIds.has(id))) {
      return NextResponse.json({ error: 'question_ids must include all questions in the test' }, { status: 400 })
    }

    for (const [position, id] of uniqueIds.entries()) {
      const { error: updateError } = await supabase
        .from('test_questions')
        .update({ position })
        .eq('test_id', testId)
        .eq('id', id)

      if (updateError) {
        console.error('Error reordering test questions:', updateError)
        return NextResponse.json({ error: 'Failed to reorder questions' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Reorder test questions error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
