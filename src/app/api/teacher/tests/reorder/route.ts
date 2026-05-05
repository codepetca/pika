import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/reorder
// body: { classroom_id: string, test_ids: string[] }
export const POST = withErrorHandler('PostTeacherTestsReorder', async (request) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, test_ids } = body as {
    classroom_id?: string
    test_ids?: string[]
  }

  if (!classroom_id || !Array.isArray(test_ids)) {
    return NextResponse.json({ error: 'classroom_id and test_ids are required' }, { status: 400 })
  }

  const uniqueIds = Array.from(new Set(test_ids.filter(Boolean)))
  if (uniqueIds.length !== test_ids.length) {
    return NextResponse.json({ error: 'test_ids must be unique' }, { status: 400 })
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()

  const { data: tests, error: testsError } = await supabase
    .from('tests')
    .select('id')
    .eq('classroom_id', classroom_id)
    .in('id', uniqueIds)

  if (testsError) {
    console.error('Error verifying tests:', testsError)
    return NextResponse.json({ error: 'Failed to verify tests' }, { status: 500 })
  }

  if ((tests || []).length !== uniqueIds.length) {
    return NextResponse.json({ error: 'One or more tests not found in classroom' }, { status: 400 })
  }

  const maxPosition = uniqueIds.length - 1
  const results = await Promise.all(
    uniqueIds.map((id, index) =>
      supabase.from('tests').update({ position: maxPosition - index }).eq('id', id)
    )
  )
  const updateError = results.find((result) => result.error)?.error ?? null

  if (updateError) {
    console.error('Error reordering tests:', updateError)
    return NextResponse.json({ error: 'Failed to reorder tests' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})
