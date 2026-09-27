import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { AuthenticatedUser } from '@/types'

const admissionVariable = 'PIKA_CLASSROOM_EXPERIENCE_ADMISSION'
const maximumConfigurationLength = 20_000
const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const admissionConfigSchema = z.object({
  version: z.literal(1),
  admittedUserIds: z.array(canonicalUuid).max(100),
}).strict().superRefine(({ admittedUserIds }, context) => {
  if (new Set(admittedUserIds).size !== admittedUserIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'admittedUserIds must not contain duplicate UUIDs',
    })
  }
})

export type ClassroomExperienceAdmission =
  | { status: 'admitted' }
  | { status: 'not-admitted' }

/** An absent variable preserves the legacy installation; every present value is strict. */
export function isClassroomExperienceAdmissionConfigured(): boolean {
  return process.env[admissionVariable] !== undefined
}

/**
 * Resolves only the configured experience cohort. It grants neither a classroom
 * relationship nor a role, plan, or permission.
 */
export function resolveClassroomExperienceAdmission(
  user: Pick<AuthenticatedUser, 'id'>,
): ClassroomExperienceAdmission {
  const raw = process.env[admissionVariable]
  if (raw === undefined) return { status: 'not-admitted' }
  const parsed = raw.length <= maximumConfigurationLength
    ? admissionConfigSchema.safeParse(parseJson(raw))
    : { success: false as const }
  const identity = canonicalUuid.safeParse(user.id)

  if (!parsed.success || !identity.success) {
    throw new ApiError(503, 'Classroom experience admission configuration is unavailable')
  }

  return parsed.data.admittedUserIds.includes(identity.data)
    ? { status: 'admitted' }
    : { status: 'not-admitted' }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
