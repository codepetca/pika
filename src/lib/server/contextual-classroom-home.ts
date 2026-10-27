import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { normalizeClassroomThemeColor, type ClassroomThemeColor } from '@/lib/classroom-theme'
import { getServiceRoleClient } from '@/lib/supabase'
import type { AuthenticatedUser } from '@/types'
import { isClassroomExperienceRegistryConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

const HOME_PAGE_SIZE = 500
// Private bounded-read ceiling, not a plan or membership allowance. An uncertain
// or oversized response must fail rather than silently return a partial home.
const HOME_READ_CEILING = 4096
type HomePage = { data: unknown; error: unknown; count: number | null }

async function completeHomeRows(query: (from: number, to: number) => PromiseLike<HomePage>): Promise<unknown[]> {
  const rows: unknown[] = []
  let total: number | undefined
  do {
    const page = await query(rows.length, rows.length + HOME_PAGE_SIZE - 1)
    if (page.error) throw new ApiError(503, 'Unable to load classroom home')
    if (!Array.isArray(page.data) || !Number.isSafeInteger(page.count)
      || page.count === null || page.count < 0 || page.count > HOME_READ_CEILING
      || (total !== undefined && total !== page.count)
      || page.data.length !== Math.min(HOME_PAGE_SIZE, page.count - rows.length)) {
      throw new ApiError(503, 'Unable to verify classroom home')
    }
    total = page.count
    rows.push(...page.data)
  } while (rows.length < total)
  return rows
}

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const homeCohortSchema = z.array(canonicalUuid).max(100)
const activeClassroomRowSchema = z.object({
  id: canonicalUuid,
  teacher_id: canonicalUuid,
  title: z.string(),
  class_code: z.string(),
  theme_color: z.string().nullish(),
  term_label: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  updated_at: z.string(),
  archived_at: z.null(),
  position: z.number().nullable().optional(),
}).passthrough()
const joinedClassroomRowSchema = z.object({
  id: canonicalUuid,
  student_id: canonicalUuid,
  classroom_id: canonicalUuid,
  created_at: z.string(),
  classrooms: activeClassroomRowSchema,
}).strict()

const JOINED_CLASSROOM_SELECT = `
  id,
  student_id,
  classroom_id,
  created_at,
  classrooms!inner(
    id,
    teacher_id,
    title,
    class_code,
    theme_color,
    term_label,
    start_date,
    end_date,
    updated_at,
    archived_at
  )
`
const OWNED_CLASSROOM_SELECT = [
  'id',
  'teacher_id',
  'title',
  'class_code',
  'theme_color',
  'term_label',
  'start_date',
  'end_date',
  'updated_at',
  'archived_at',
  'position',
].join(',')

export type ClassroomHomeItem = {
  id: string
  title: string
  class_code: string
  theme_color: ClassroomThemeColor
  term_label: string | null
  start_date: string | null
  end_date: string | null
  updated_at: string
  relationship: 'owner' | 'member'
  position?: number
  enrollment_id?: string
  enrolled_at?: string
}

export type ContextualClassroomHome = {
  owned: ClassroomHomeItem[]
  joined: ClassroomHomeItem[]
}

function configuredHomeCohort(): string[] | null {
  const raw = process.env.PIKA_CLASSROOM_HOME_ACCESS_USER_IDS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = homeCohortSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Authenticate before evaluating the server-only cohort. This gate is intentionally
 * independent from the classroom-core pair pilot: home admission reveals every
 * current relationship for one identity, not a cross-product of configured IDs.
 */
export async function isContextualClassroomHomeAdmitted(user: Pick<AuthenticatedUser, 'id'>): Promise<boolean> {
  if (process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED !== 'true') {
    return false
  }

  if (isClassroomExperienceRegistryConfigured()) {
    return (await resolveClassroomExperienceAdmission(user)).status === 'admitted'
  }

  const cohort = configuredHomeCohort()
  const identity = canonicalUuid.safeParse(user.id)
  if (cohort === null || !identity.success) {
    throw new ApiError(503, 'Classroom home access configuration is unavailable')
  }
  return cohort.includes(identity.data)
}

export async function authenticateContextualClassroomHome(): Promise<AuthenticatedUser> {
  const user = await requireAuth()
  if (!(await isContextualClassroomHomeAdmitted(user))) throw new ApiError(404, 'Not found')
  return user
}

function homeItem(
  row: z.infer<typeof activeClassroomRowSchema>,
  relationship: 'owner' | 'member',
  enrollment?: { id: string; created_at: string },
): ClassroomHomeItem {
  return {
    id: row.id,
    title: row.title,
    class_code: row.class_code,
    theme_color: normalizeClassroomThemeColor(row.theme_color),
    term_label: row.term_label,
    start_date: row.start_date,
    end_date: row.end_date,
    updated_at: row.updated_at,
    relationship,
    ...(typeof row.position === 'number' ? { position: row.position } : {}),
    ...(enrollment ? { enrollment_id: enrollment.id, enrolled_at: enrollment.created_at } : {}),
  }
}

/**
 * Load the active home relationships for one already-authenticated identity.
 * The service client is safe here only because both reads are bound to that identity;
 * every returned row is validated again before it can cross the API boundary.
 */
export async function loadContextualClassroomHome(
  userId: string,
  options: { supabase?: SupabaseClient } = {},
): Promise<ContextualClassroomHome> {
  const identity = canonicalUuid.safeParse(userId)
  if (!identity.success) throw new ApiError(503, 'Unable to verify classroom home identity')

  const supabase = options.supabase ?? getServiceRoleClient()
  const [ownedData, joinedData] = await Promise.all([
    completeHomeRows((from, to) => supabase
      .from('classrooms')
      .select(OWNED_CLASSROOM_SELECT, { count: 'exact' })
      .eq('teacher_id', identity.data)
      .is('archived_at', null)
      .order('position', { ascending: true })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
      .abortSignal(AbortSignal.timeout(10_000))),
    completeHomeRows((from, to) => supabase
      .from('classroom_enrollments')
      .select(JOINED_CLASSROOM_SELECT, { count: 'exact' })
      .eq('student_id', identity.data)
      .is('classrooms.archived_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
      .abortSignal(AbortSignal.timeout(10_000))),
  ])

  const ownedRows = z.array(activeClassroomRowSchema).safeParse(ownedData)
  const joinedRows = z.array(joinedClassroomRowSchema).safeParse(joinedData)
  if (!ownedRows.success || !joinedRows.success) {
    throw new ApiError(503, 'Unable to verify classroom home')
  }
  // A repeated primary key can conceal an omitted row when a paginated order
  // changes between requests. Do not turn that uncertain read into success.
  if (new Set(ownedRows.data.map(row => row.id)).size !== ownedRows.data.length
    || new Set(joinedRows.data.map(row => row.id)).size !== joinedRows.data.length) {
    throw new ApiError(503, 'Unable to verify classroom home')
  }
  if (ownedRows.data.some((row) => row.teacher_id !== identity.data)) {
    throw new ApiError(503, 'Unable to verify classroom home')
  }
  if (joinedRows.data.some((row) => row.student_id !== identity.data)) {
    throw new ApiError(503, 'Unable to verify classroom home')
  }
  if (joinedRows.data.some((row) => row.classroom_id !== row.classrooms.id)) {
    throw new ApiError(503, 'Unable to verify classroom home')
  }

  const ownedIds = new Set(ownedRows.data.map((row) => row.id))
  const joinedIds = new Set<string>()
  const joined: ClassroomHomeItem[] = []
  for (const enrollment of joinedRows.data) {
    const classroom = enrollment.classrooms
    // Ownership takes precedence over any stale or historical self-enrollment.
    if (classroom.teacher_id === identity.data || ownedIds.has(classroom.id) || joinedIds.has(classroom.id)) continue
    joinedIds.add(classroom.id)
    joined.push(homeItem(classroom, 'member', enrollment))
  }

  return {
    owned: ownedRows.data.map((row) => homeItem(row, 'owner')),
    joined,
  }
}
