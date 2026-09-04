import { z } from 'zod'

// Feature-scoped keys only, e.g. "onboarding:classroom:<uuid>". Keeps the
// table generic (any feature can claim a key) without allowing arbitrary
// free-text keys.
export const teacherUiStateKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9:_-]*$/i, 'Key must be alphanumeric with : _ - separators')

export const getTeacherUiStateQuerySchema = z.object({
  key: teacherUiStateKeySchema,
})

const MAX_VALUE_BYTES = 4_000

export const setTeacherUiStateBodySchema = z.object({
  key: teacherUiStateKeySchema,
  value: z.record(z.string(), z.json()).refine(
    (value) => JSON.stringify(value).length <= MAX_VALUE_BYTES,
    { message: `value must serialize to ${MAX_VALUE_BYTES} bytes or fewer` },
  ),
})

export type SetTeacherUiStateInput = z.infer<typeof setTeacherUiStateBodySchema>
