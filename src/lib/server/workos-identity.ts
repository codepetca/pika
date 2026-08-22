import type { User as WorkOSUser } from '@workos-inc/node'
import type { UserRole } from '@/types'
import { ApiError } from '@/lib/api-error'
import { isTeacherEmail } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

export interface PikaAuthUser {
  id: string
  email: string
  role: UserRole
  workosUserId: string
}

interface StoredPikaAuthUser {
  id: string
  email: string
  role: string
  workos_user_id: string | null
}

export interface WorkOSIdentityStore {
  findByWorkOSUserId(workosUserId: string): Promise<StoredPikaAuthUser | null>
  findByEmail(email: string): Promise<StoredPikaAuthUser | null>
  claimExistingUser(input: {
    userId: string
    workosUserId: string
    emailVerifiedAt: string
  }): Promise<StoredPikaAuthUser | null>
  createUser(input: {
    email: string
    role: UserRole
    workosUserId: string
    emailVerifiedAt: string
  }): Promise<StoredPikaAuthUser | null>
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function toPikaAuthUser(user: StoredPikaAuthUser, expectedWorkOSUserId: string): PikaAuthUser {
  if (user.role !== 'student' && user.role !== 'teacher') {
    throw new ApiError(409, 'Account configuration conflict')
  }
  if (user.workos_user_id !== expectedWorkOSUserId) {
    throw new ApiError(409, 'Account identity conflict')
  }

  return {
    id: user.id,
    email: normalizeEmail(user.email),
    role: user.role,
    workosUserId: expectedWorkOSUserId,
  }
}

async function recoverConsistentIdentity(
  store: WorkOSIdentityStore,
  workosUserId: string,
  email: string,
): Promise<PikaAuthUser | null> {
  const [byWorkOSId, byEmail] = await Promise.all([
    store.findByWorkOSUserId(workosUserId),
    store.findByEmail(email),
  ])

  if (!byWorkOSId || !byEmail || byWorkOSId.id !== byEmail.id) return null
  if (normalizeEmail(byWorkOSId.email) !== email) return null
  return toPikaAuthUser(byWorkOSId, workosUserId)
}

export async function resolvePikaUserFromWorkOS(
  workosUser: Pick<WorkOSUser, 'id' | 'email' | 'emailVerified'>,
  store: WorkOSIdentityStore = createSupabaseWorkOSIdentityStore(),
): Promise<PikaAuthUser> {
  if (!workosUser.emailVerified) {
    throw new ApiError(401, 'Email verification is required')
  }

  const email = normalizeEmail(workosUser.email)
  const emailVerifiedAt = new Date().toISOString()
  const existingByWorkOSId = await store.findByWorkOSUserId(workosUser.id)

  if (existingByWorkOSId) {
    if (normalizeEmail(existingByWorkOSId.email) !== email) {
      throw new ApiError(409, 'Account identity conflict')
    }
    return toPikaAuthUser(existingByWorkOSId, workosUser.id)
  }

  const existingByEmail = await store.findByEmail(email)
  if (existingByEmail) {
    if (existingByEmail.workos_user_id && existingByEmail.workos_user_id !== workosUser.id) {
      throw new ApiError(409, 'Account identity conflict')
    }

    const claimed = await store.claimExistingUser({
      userId: existingByEmail.id,
      workosUserId: workosUser.id,
      emailVerifiedAt,
    })
    if (claimed) return toPikaAuthUser(claimed, workosUser.id)

    const recovered = await recoverConsistentIdentity(store, workosUser.id, email)
    if (recovered) return recovered
    throw new ApiError(409, 'Account identity conflict')
  }

  const created = await store.createUser({
    email,
    role: isTeacherEmail(email) ? 'teacher' : 'student',
    workosUserId: workosUser.id,
    emailVerifiedAt,
  })
  if (created) return toPikaAuthUser(created, workosUser.id)

  const recovered = await recoverConsistentIdentity(store, workosUser.id, email)
  if (recovered) return recovered
  throw new ApiError(409, 'Account identity conflict')
}

export async function findLinkedPikaUserFromWorkOS(
  workosUser: Pick<WorkOSUser, 'id' | 'email' | 'emailVerified'>,
  store: WorkOSIdentityStore = createSupabaseWorkOSIdentityStore(),
): Promise<PikaAuthUser | null> {
  if (!workosUser.emailVerified) return null

  const email = normalizeEmail(workosUser.email)
  const linked = await store.findByWorkOSUserId(workosUser.id)
  if (!linked || normalizeEmail(linked.email) !== email) return null

  return toPikaAuthUser(linked, workosUser.id)
}

export function createSupabaseWorkOSIdentityStore(): WorkOSIdentityStore {
  const supabase = getServiceRoleClient()
  const selectFields = 'id, email, role, workos_user_id'

  async function findOne(field: 'email' | 'workos_user_id', value: string): Promise<StoredPikaAuthUser | null> {
    const { data, error } = await supabase
      .from('users')
      .select(selectFields)
      .eq(field, value)
      .maybeSingle()

    if (error) throw new Error(`Failed to resolve Pika identity (${error.code ?? 'unknown'})`)
    return data as StoredPikaAuthUser | null
  }

  return {
    findByWorkOSUserId: workosUserId => findOne('workos_user_id', workosUserId),
    findByEmail: email => findOne('email', email),
    async claimExistingUser({ userId, workosUserId, emailVerifiedAt }) {
      const { data, error } = await supabase
        .from('users')
        .update({ workos_user_id: workosUserId, email_verified_at: emailVerifiedAt })
        .eq('id', userId)
        .is('workos_user_id', null)
        .select(selectFields)
        .maybeSingle()

      if (error?.code === '23505') return null
      if (error) throw new Error(`Failed to link Pika identity (${error.code ?? 'unknown'})`)
      return data as StoredPikaAuthUser | null
    },
    async createUser({ email, role, workosUserId, emailVerifiedAt }) {
      const { data, error } = await supabase
        .from('users')
        .insert({
          email,
          role,
          workos_user_id: workosUserId,
          email_verified_at: emailVerifiedAt,
        })
        .select(selectFields)
        .maybeSingle()

      if (error?.code === '23505') return null
      if (error) throw new Error(`Failed to create Pika identity (${error.code ?? 'unknown'})`)
      return data as StoredPikaAuthUser | null
    },
  }
}
