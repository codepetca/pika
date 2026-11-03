import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { authorizeSharedTestListReadActor } from '@/lib/server/contextual-test-list-read'
import { chunkValues } from '@/lib/server/query-chunks'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { contextualTestListQuerySchema } from '@/lib/validations/contextual-test-list-read'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The shared classroom experience retains its separately authorized full read.
export const GET = withErrorHandler('GetTeacherTestSummary', async (request) => {
  const actor = await authorizeSharedTestListReadActor()
  if (actor.mode === 'shared') return NextResponse.json({ error: 'Unavailable' }, { status: 404 })
  const user = await requireRole('teacher')
  const { classroomId } = contextualTestListQuerySchema.parse({ classroomId: new URL(request.url).searchParams.get('classroom_id') })
  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  const supabase = getServiceRoleClient()
  const { data: tests, error } = await supabase.from('tests').select('*').eq('classroom_id', classroomId)
    .order('position', { ascending: false }).order('created_at', { ascending: false })
  if (error) {
    if (error.code === 'PGRST205') return NextResponse.json({ tests: [], migration_required: true })
    return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
  }
  // The Data API may cap a result at 1,000 rows. Never present a truncated
  // summary as the complete list; the existing full read remains the fallback.
  if ((tests || []).length >= 1000) return NextResponse.json({ error: 'Summary unavailable' }, { status: 503 })
  const drafts = new Map<string, { title: string; show_results: boolean }>()
  for (const ids of chunkValues((tests || []).filter(test => test.status === 'draft').map(test => test.id))) {
    const { data, error: draftError } = await supabase.from('assessment_drafts').select('assessment_id, content')
      .eq('assessment_type', 'test').in('assessment_id', ids)
    if (draftError) return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    for (const row of data || []) {
      const parsed = validateTestDraftContent(row.content, { allowEmptyQuestionText: true })
      if (parsed.valid) drafts.set(row.assessment_id, parsed.value)
    }
  }
  return NextResponse.json({ tests: (tests || []).map(test => {
    const draft = drafts.get(test.id)
    return { ...test, title: draft?.title ?? test.title, show_results: draft?.show_results ?? test.show_results,
      assessment_type: 'test', documents: normalizeTestDocuments(test.documents) }
  }) })
})
