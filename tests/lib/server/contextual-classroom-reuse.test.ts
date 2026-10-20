import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizeClassroomReuseActor, assertContextualReuseProposal, filterContextualReuseProposals } from '@/lib/server/contextual-classroom-reuse'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

const auth = vi.hoisted(() => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/auth', () => auth)
const actorId = '10000000-0000-4000-8000-000000000001'
const blueprintId = '20000000-0000-4000-8000-000000000001'
const classroomId = '30000000-0000-4000-8000-000000000001'
const proposal = { teacher_id: actorId, course_blueprint_id: blueprintId, source_classroom_id: classroomId, target_kind: 'blueprint', source_kind: 'classroom' }

describe('contextual archived classroom reuse boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    auth.requireRole.mockResolvedValue({ id: actorId, role: 'teacher' })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('retains the original teacher guard without admission', async () => {
    expect(await authorizeClassroomReuseActor()).toMatchObject({ contextual: false })
    expect(auth.requireRole).toHaveBeenCalledWith('teacher')
    expect(auth.requireAuth).not.toHaveBeenCalled()
  })
  it.each(['teacher', 'student'])('admits an authenticated %s label without granting a role', async (role) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    auth.requireAuth.mockResolvedValue({ id: actorId, role })
    expect(await authorizeClassroomReuseActor()).toEqual({ user: { id: actorId, role }, contextual: true })
    expect(auth.requireRole).not.toHaveBeenCalled()
  })
  it('retains the teacher guard for an unmatched actor', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    auth.requireAuth.mockResolvedValue({ id: actorId, role: 'student' })
    auth.requireRole.mockRejectedValue(new Error('Forbidden'))
    await expect(authorizeClassroomReuseActor()).rejects.toThrow('Forbidden')
  })
  it('fails closed on malformed admission before a legacy guard or writer', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    auth.requireAuth.mockResolvedValue({ id: actorId, role: 'teacher' })
    await expect(authorizeClassroomReuseActor()).rejects.toMatchObject({ statusCode: 503 })
    expect(auth.requireRole).not.toHaveBeenCalled()
  })
  it.each([
    { teacher_id: 'other' }, { course_blueprint_id: 'other' }, { target_kind: 'classroom' },
    { source_kind: 'package' }, { source_kind: 'ai' }, { source_kind: 'repository' }, { source_classroom_id: null },
  ])('rejects proposal substitution %j before source reads', async (change) => {
    const supabase = { from: vi.fn() }
    await expect(assertContextualReuseProposal(supabase as any, actorId, blueprintId, { ...proposal, ...change })).rejects.toMatchObject({ statusCode: 403 })
    expect(supabase.from).not.toHaveBeenCalled()
  })
  it.each([
    { teacher_id: 'other' }, { archived_at: null }, { source_blueprint_id: 'other' },
  ])('rejects revoked archived source relationship %j', async (change) => {
    const supabase = makeSupabaseFromQueues({ classrooms: [makeQueryBuilder({ data: { id: classroomId, teacher_id: actorId, archived_at: '2026-10-01', source_blueprint_id: blueprintId, ...change } })] })
    await expect(assertContextualReuseProposal(supabase as any, actorId, blueprintId, proposal)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('accepts only the stored classroom source with its current owner and lineage', async () => {
    const query = makeQueryBuilder({ data: { id: classroomId, teacher_id: actorId, archived_at: '2026-10-01', source_blueprint_id: blueprintId } })
    const supabase = makeSupabaseFromQueues({ classrooms: [query] })
    await expect(assertContextualReuseProposal(supabase as any, actorId, blueprintId, proposal)).resolves.toBeUndefined()
    expect(query.eq).toHaveBeenCalledWith('id', classroomId)
    expect(query.eq).toHaveBeenCalledWith('teacher_id', actorId)
  })
  it('permits an active proposal source only with the server-controlled legacy allowance', async () => {
    const makeSupabase = () => makeSupabaseFromQueues({ classrooms: [makeQueryBuilder({ data: { id: classroomId, teacher_id: actorId, archived_at: null, source_blueprint_id: blueprintId } })] })
    await expect(assertContextualReuseProposal(makeSupabase() as any, actorId, blueprintId, proposal)).rejects.toMatchObject({ statusCode: 403 })
    await expect(assertContextualReuseProposal(makeSupabase() as any, actorId, blueprintId, proposal, { allowActiveLegacy: true })).resolves.toBeUndefined()
  })
  it.each([{ teacher_id: 'other' }, { source_blueprint_id: 'other' }, { id: 'other' }])('retains source identity and ownership with the active allowance %j', async (change) => {
    const supabase = makeSupabaseFromQueues({ classrooms: [makeQueryBuilder({ data: { id: classroomId, teacher_id: actorId, archived_at: null, source_blueprint_id: blueprintId, ...change } })] })
    await expect(assertContextualReuseProposal(supabase as any, actorId, blueprintId, proposal, { allowActiveLegacy: true })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('lists only currently owned archived classroom proposals using one batch source read', async () => {
    const otherClassroom = '30000000-0000-4000-8000-000000000002'
    const query = makeQueryBuilder({ data: [
      { id: classroomId, teacher_id: actorId, archived_at: '2026-10-01', source_blueprint_id: blueprintId },
      { id: otherClassroom, teacher_id: 'other', archived_at: '2026-10-01', source_blueprint_id: blueprintId },
    ] })
    const supabase = makeSupabaseFromQueues({ classrooms: [query] })
    expect(await filterContextualReuseProposals(supabase as any, actorId, blueprintId, [
      proposal, { ...proposal, source_classroom_id: otherClassroom },
      { ...proposal, teacher_id: 'other' }, { ...proposal, source_kind: 'ai' },
      { ...proposal, target_kind: 'classroom' },
    ])).toEqual([proposal])
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(query.in).toHaveBeenCalledWith('id', [classroomId, otherClassroom])
  })
})
