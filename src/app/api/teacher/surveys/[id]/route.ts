import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { canActivateSurvey, hasSurveyOpened } from '@/lib/surveys'
import { assertTeacherOwnsSurvey } from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import type { SurveyStatus } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherSurvey', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params

  const access = await assertTeacherOwnsSurvey(user.id, id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: questions, error: questionsError } = await supabase
    .from('survey_questions')
    .select('*')
    .eq('survey_id', id)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching survey questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  return NextResponse.json({
    survey: access.survey,
    questions: questions || [],
    classroom: access.survey.classrooms,
  })
})

export const PATCH = withErrorHandler('PatchTeacherSurvey', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const { title, status, show_results, dynamic_responses, opens_at } = body as {
    title?: string
    status?: SurveyStatus
    show_results?: boolean
    dynamic_responses?: boolean
    opens_at?: string | null
  }

  const access = await assertTeacherOwnsSurvey(user.id, id, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const existing = access.survey
  const supabase = getServiceRoleClient()

  let parsedOpensAt: string | null | undefined
  if (opens_at !== undefined) {
    if (opens_at === null) {
      parsedOpensAt = null
    } else {
      const parsed = new Date(opens_at)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid open date' }, { status: 400 })
      }
      parsedOpensAt = parsed.toISOString()
    }
  }

  if (status !== undefined) {
    const validStatuses: SurveyStatus[] = ['draft', 'active', 'closed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    if (existing.status === 'active' && status === 'draft' && hasSurveyOpened(existing)) {
      return NextResponse.json(
        { error: 'Cannot revert a survey that has already opened to draft' },
        { status: 400 }
      )
    }

    const validTransitions: Record<SurveyStatus, SurveyStatus[]> = {
      draft: ['active'],
      active: ['closed', 'draft'],
      closed: ['active'],
    }
    if (!validTransitions[existing.status].includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${existing.status} to ${status}` },
        { status: 400 }
      )
    }
  }

  if (status === 'active' && existing.status === 'draft') {
    const { count: questionsCount } = await supabase
      .from('survey_questions')
      .select('*', { count: 'exact', head: true })
      .eq('survey_id', id)

    const activation = canActivateSurvey(existing, questionsCount || 0)
    if (!activation.valid) {
      return NextResponse.json({ error: activation.error }, { status: 400 })
    }
  }

  if (title !== undefined && !title.trim()) {
    return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
  }
  if (show_results !== undefined && typeof show_results !== 'boolean') {
    return NextResponse.json({ error: 'show_results must be a boolean' }, { status: 400 })
  }
  if (dynamic_responses !== undefined && typeof dynamic_responses !== 'boolean') {
    return NextResponse.json({ error: 'dynamic_responses must be a boolean' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (title !== undefined) updates.title = title.trim()
  if (status !== undefined) updates.status = status
  if (show_results !== undefined) updates.show_results = show_results
  if (dynamic_responses !== undefined) updates.dynamic_responses = dynamic_responses
  if (opens_at !== undefined) updates.opens_at = parsedOpensAt

  if (status === 'active') {
    updates.opens_at = parsedOpensAt ?? new Date().toISOString()
  }
  if (status === 'draft') {
    updates.opens_at = null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data: survey, error } = await supabase
    .from('surveys')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error || !survey) {
    console.error('Error updating survey:', error)
    return NextResponse.json({ error: 'Failed to update survey' }, { status: 500 })
  }

  return NextResponse.json({ survey })
})

export const DELETE = withErrorHandler('DeleteTeacherSurvey', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params

  const access = await assertTeacherOwnsSurvey(user.id, id, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { error } = await supabase
    .from('surveys')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting survey:', error)
    return NextResponse.json({ error: 'Failed to delete survey' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})
