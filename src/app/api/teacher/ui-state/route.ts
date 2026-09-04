import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { fetchTeacherUiState, upsertTeacherUiState } from '@/lib/server/teacher-ui-state'
import { getTeacherUiStateQuerySchema, setTeacherUiStateBodySchema } from '@/lib/validations/teacher-ui-state'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/ui-state?key=xxx
 * Reads the authenticated teacher's stored value for one UI-state key
 * (onboarding dismissal/progress, or any future one-time guidance).
 * Returns { value: null } when nothing has been stored yet.
 */
export const GET = withErrorHandler('GetTeacherUiState', async (request) => {
  const user = await requireRole('teacher')

  const { searchParams } = new URL(request.url)
  const { key } = getTeacherUiStateQuerySchema.parse({ key: searchParams.get('key') })

  const { value, error } = await fetchTeacherUiState(user.id, key)
  if (error) {
    console.error('Error fetching teacher UI state:', error)
    return NextResponse.json({ error: 'Failed to fetch UI state' }, { status: 500 })
  }

  return NextResponse.json({ value })
})

/**
 * PATCH /api/teacher/ui-state
 * Body: { key, value }
 * Upserts the authenticated teacher's stored value for one UI-state key.
 */
export const PATCH = withErrorHandler('PatchTeacherUiState', async (request) => {
  const user = await requireRole('teacher')

  const body = setTeacherUiStateBodySchema.parse(await request.json())

  const { error } = await upsertTeacherUiState(user.id, body.key, body.value)
  if (error) {
    console.error('Error saving teacher UI state:', error)
    return NextResponse.json({ error: 'Failed to save UI state' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
})
