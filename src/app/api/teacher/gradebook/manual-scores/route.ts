import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  deleteTeacherGradebookScoreOverride,
  saveTeacherGradebookScoreOverride,
} from '@/lib/server/gradebook'
import {
  gradebookScoreOverrideDeleteSchema,
  gradebookScoreOverridePutSchema,
} from '@/lib/validations/gradebook-score-overrides'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export const PUT = withErrorHandler('PutGradebookManualScore', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const command = gradebookScoreOverridePutSchema.parse(await readJson(request))
  const result = await saveTeacherGradebookScoreOverride({ teacherId: user.id, command })
  return NextResponse.json(result)
})

export const DELETE = withErrorHandler('DeleteGradebookManualScore', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const command = gradebookScoreOverrideDeleteSchema.parse(await readJson(request))
  const result = await deleteTeacherGradebookScoreOverride({ teacherId: user.id, command })
  return NextResponse.json(result)
})
