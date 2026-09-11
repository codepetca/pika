import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  getActiveStudentPurgeStatus,
  getStudentPurgeImpact,
  startStudentPurge,
} from '@/lib/server/student-purge'
import { studentPurgeStartRequestSchema } from '@/lib/validations/student-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler('GetTeacherStudentPurgeImpact', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id, studentId } = await context.params
  const classroomId = uuidSchema.parse(id)
  const parsedStudentId = uuidSchema.parse(studentId)
  const [impact, operation] = await Promise.all([
    getStudentPurgeImpact(user.id, classroomId, parsedStudentId),
    getActiveStudentPurgeStatus(user.id, classroomId, parsedStudentId),
  ])
  return NextResponse.json({ impact, operation })
})

export const POST = withErrorHandler('PostTeacherStudentPurge', async (request, context) => {
  const user = await requireRole('teacher')
  const { id, studentId } = await context.params
  const input = studentPurgeStartRequestSchema.parse(await request.json())
  const operation = await startStudentPurge({
    teacherId: user.id,
    classroomId: uuidSchema.parse(id),
    studentId: uuidSchema.parse(studentId),
    operationId: input.operation_id,
    confirmation: input.confirmation,
    expectedSourceRevision: input.expected_source_revision,
    expectedStorageInventorySha256: input.expected_storage_inventory_sha256,
    expectedRelationalInventorySha256: input.expected_relational_inventory_sha256,
  })
  return NextResponse.json({ operation }, { status: operation.status === 'completed' ? 200 : 202 })
})
