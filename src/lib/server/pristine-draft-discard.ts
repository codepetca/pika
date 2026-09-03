import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TableRow } from '@/types/database'

type DatabaseError = { code?: string; message?: string }

const assignmentDiscardResultSchema = z.discriminatedUnion('discarded', [
  z.object({ discarded: z.literal(true) }).passthrough(),
  z.object({
    discarded: z.literal(false),
    assignment: z.record(z.string(), z.unknown()),
  }).passthrough(),
])

const testDiscardResultSchema = z.discriminatedUnion('discarded', [
  z.object({ discarded: z.literal(true) }).passthrough(),
  z.object({
    discarded: z.literal(false),
    test: z.record(z.string(), z.unknown()),
  }).passthrough(),
])

function mapDiscardError(error: DatabaseError, resource: 'Assignment' | 'Test'): never {
  if (error.code === 'P0002') throw new ApiError(404, error.message || `${resource} not found`)
  if (error.code === '42501' || error.code === '55000') {
    throw new ApiError(403, error.message || `${resource} discard is not allowed`)
  }
  if (error.code === '22023' || error.code === '22P02') {
    throw new ApiError(400, error.message || `${resource} discard payload is invalid`)
  }
  throw new Error(`Failed to discard pristine ${resource}`)
}

export async function discardPristineAssignmentDraftAtomic(input: {
  assignmentId: string
  teacherId: string
  expectedUpdatedAt: string
}): Promise<
  | { discarded: true }
  | { discarded: false; assignment: TableRow<'assignments'> }
> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('discard_pristine_assignment_draft_atomic', {
    p_assignment_id: input.assignmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_teacher_id: input.teacherId,
  })

  if (error) mapDiscardError(error as DatabaseError, 'Assignment')

  const parsed = assignmentDiscardResultSchema.safeParse(data)
  if (!parsed.success) throw new Error('Invalid pristine Assignment discard result')
  if (parsed.data.discarded) return { discarded: true }
  return {
    discarded: false,
    assignment: parsed.data.assignment as TableRow<'assignments'>,
  }
}

export async function discardPristineTestDraftAtomic(input: {
  testId: string
  teacherId: string
  expectedDraftVersion: number
}): Promise<
  | { discarded: true }
  | { discarded: false; test: TableRow<'tests'> }
> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('discard_pristine_test_draft_atomic', {
    p_expected_draft_version: input.expectedDraftVersion,
    p_teacher_id: input.teacherId,
    p_test_id: input.testId,
  })

  if (error) mapDiscardError(error as DatabaseError, 'Test')

  const parsed = testDiscardResultSchema.safeParse(data)
  if (!parsed.success) throw new Error('Invalid pristine Test discard result')
  if (parsed.data.discarded) return { discarded: true }
  return {
    discarded: false,
    test: parsed.data.test as TableRow<'tests'>,
  }
}
