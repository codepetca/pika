import { z } from 'zod'

export const TEST_SESSION_READ_BYTES = 4096
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const stamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const testSessionReadProjectionSchema = z.object({
  test_status: z.enum(['active', 'closed']), is_submitted: z.boolean(),
  returned_at: stamp.nullable(), closed_for_grading_at: stamp.nullable(),
  access_state: z.enum(['open', 'closed']).nullable(), has_submitted: z.boolean(),
}).strict()
export const testSessionReadSnapshotSchema = z.object({
  version: z.literal(1), actor_id: uuid, test_id: uuid, classroom_id: uuid.nullable(),
  outcome: z.enum(['ok', 'forbidden', 'not_found', 'unavailable']),
  projection: testSessionReadProjectionSchema.nullable(),
}).strict().refine(value => value.outcome === 'ok'
  ? value.classroom_id !== null && value.projection !== null
  : value.projection === null)
