import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { AuthenticatedUser } from '@/types'
import { readClassroomAdmissionRegistry } from '@/lib/server/classroom-admission-registry'

const admissionVariable = 'PIKA_CLASSROOM_EXPERIENCE_ADMISSION'
const maximumConfigurationLength = 20_000
const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const versionOneSchema = z.object({
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
const registrySourceSchema = z.object({
  version: z.literal(2),
  source: z.literal('registry'),
  bootstrapManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
const admissionConfigSchema = z.union([versionOneSchema, registrySourceSchema])

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
export async function resolveClassroomExperienceAdmission(
  user: Pick<AuthenticatedUser, 'id'>,
): Promise<ClassroomExperienceAdmission> {
  return resolveAdmission(user, false)
}

/** Compatibility only: wider grants never select a new attendance protocol. */
export async function resolveAttendanceProtocolCompatibility(
  user: Pick<AuthenticatedUser, 'id'>,
): Promise<ClassroomExperienceAdmission> {
  return resolveAdmission(user, true)
}

export function isClassroomExperienceRegistryConfigured(): boolean {
  return configuredSource()?.version === 2
}

function configuredSource(): z.infer<typeof admissionConfigSchema> | undefined {
  const raw = process.env[admissionVariable]
  if (raw === undefined) return undefined
  const parsed = raw.length <= maximumConfigurationLength
    ? admissionConfigSchema.safeParse(parseJson(raw)) : { success: false as const }
  if (!parsed.success) {
    throw new ApiError(503, 'Classroom experience admission configuration is unavailable')
  }
  return parsed.data
}

async function resolveAdmission(
  user: Pick<AuthenticatedUser, 'id'>,
  protocolOnly: boolean,
): Promise<ClassroomExperienceAdmission> {
  const configuration = configuredSource()
  if (!configuration) return { status: 'not-admitted' }
  const identity = canonicalUuid.safeParse(user.id)

  if (!identity.success) {
    throw new ApiError(503, 'Classroom experience admission configuration is unavailable')
  }

  const admitted = configuration.version === 1
    ? configuration.admittedUserIds.includes(identity.data)
    : await readClassroomAdmissionRegistry(identity.data, configuration.bootstrapManifestSha256)
      .then((decision) => protocolOnly ? decision.bootstrap_member : decision.admitted)
  return admitted
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
