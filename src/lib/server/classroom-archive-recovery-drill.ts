import { z } from 'zod'

export const CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK =
  'I_UNDERSTAND_THIS_DELETES_LOCAL_FIXTURE_DATA'

const localServiceRoleClaimsSchema = z.object({
  iss: z.literal('supabase-demo'),
  role: z.literal('service_role'),
}).passthrough()

export type LocalClassroomArchiveRecoveryDrillTarget = {
  supabaseUrl: string
}

function decodeJwtClaims(value: string): unknown {
  const segments = value.split('.')
  if (segments.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function assertLocalClassroomArchiveRecoveryDrillTarget(args: {
  acknowledgement: string | undefined
  serviceRoleKey: string | undefined
  supabaseUrl: string | undefined
}): LocalClassroomArchiveRecoveryDrillTarget {
  if (args.acknowledgement !== CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK) {
    throw new Error('Classroom archive recovery drill acknowledgement is missing')
  }
  if (!args.supabaseUrl) {
    throw new Error('Classroom archive recovery drill Supabase URL is missing')
  }

  let url: URL
  try {
    url = new URL(args.supabaseUrl)
  } catch {
    throw new Error('Classroom archive recovery drill Supabase URL is invalid')
  }

  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Classroom archive recovery drill requires a loopback Supabase URL')
  }

  const claims = localServiceRoleClaimsSchema.safeParse(
    args.serviceRoleKey ? decodeJwtClaims(args.serviceRoleKey) : null,
  )
  if (!claims.success) {
    throw new Error('Classroom archive recovery drill requires a local service-role key')
  }

  return { supabaseUrl: url.origin }
}
