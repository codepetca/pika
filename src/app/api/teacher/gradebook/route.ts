import { authorizeSharedGradebookActor, readContextualGradebookOwner, patchContextualGradebook, replaceContextualGradebookCategories } from '@/lib/server/contextual-gradebook'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  loadTeacherGradebook,
  replaceTeacherGradebookCategories,
  updateTeacherGradebook,
} from '@/lib/server/gradebook'
import {
  gradebookCategoriesPutSchema,
  gradebookPatchSchema,
  gradebookQuerySchema,
} from '@/lib/validations/gradebook'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const GET = withErrorHandler('GetGradebook', async (request: NextRequest) => {
  const access = await authorizeSharedGradebookActor()
  const user = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const query = gradebookQuerySchema.parse({
    classroom_id: request.nextUrl.searchParams.get('classroom_id') ?? '',
    student_id: request.nextUrl.searchParams.get('student_id'),
  })
  const gradebook = access.mode === 'shared' ? await readContextualGradebookOwner({ actorId: user.id, classroomId: query.classroom_id, selectedStudentId: query.student_id, signal: request.signal }) : await loadTeacherGradebook({
    teacherId: user.id,
    classroomId: query.classroom_id,
    selectedStudentId: query.student_id,
  })
  return NextResponse.json(gradebook, access.mode === 'shared' ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined)
})
export const PATCH = withErrorHandler('PatchGradebook', async (request: NextRequest) => {
  const access = await authorizeSharedGradebookActor()
  const user = access.mode === 'shared' ? access.user : await requireRole('teacher')
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const command = gradebookPatchSchema.parse(rawBody)
  const result = access.mode === 'shared' ? await patchContextualGradebook(user.id, command, request.signal) : await updateTeacherGradebook({ teacherId: user.id, command })
  return NextResponse.json(result)
})

export const PUT = withErrorHandler('PutGradebookCategories', async (request: NextRequest) => {
  const access = await authorizeSharedGradebookActor()
  const user = access.mode === 'shared' ? access.user : await requireRole('teacher')
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const command = gradebookCategoriesPutSchema.parse(rawBody)
  const result = access.mode === 'shared' ? await replaceContextualGradebookCategories(user.id, command, request.signal) : await replaceTeacherGradebookCategories({ teacherId: user.id, command })
  return NextResponse.json(result)
})
