import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomsIndexPage from '@/app/classrooms/page'
import { TeacherClassroomsIndex } from '@/app/classrooms/TeacherClassroomsIndex'
import { StudentClassroomsIndex } from '@/app/classrooms/StudentClassroomsIndex'
import type { ReactElement } from 'react'

const mocks = vi.hoisted(() => ({
  user: vi.fn(), teacher: vi.fn(), from: vi.fn(), redirect: vi.fn(), display: vi.fn(),
  homeAdmission: vi.fn(), experienceAdmission: vi.fn(), home: vi.fn(), visibility: vi.fn(), creation: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.user }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/server/classroom-order', () => ({ listActiveTeacherClassrooms: mocks.teacher }))
vi.mock('@/lib/user-profile', () => ({ getUserDisplayInfo: mocks.display }))
vi.mock('@/lib/server/auth-redirect', () => ({ getServerLoginRedirectPath: async () => '/login' }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/integrations/pal', () => ({ StudentPalAmbientSurfaces: () => null }))
vi.mock('@/lib/server/pal-config', () => ({ getPalApiUrl: () => undefined }))
vi.mock('@/components/AppShell', () => ({ AppShell: () => null }))
vi.mock('@/app/classrooms/TeacherClassroomsIndex', () => ({ TeacherClassroomsIndex: () => null }))
vi.mock('@/app/classrooms/StudentClassroomsIndex', () => ({ StudentClassroomsIndex: () => null }))
vi.mock('@/lib/server/classrooms', () => ({ hydrateClassroomRecords: (data: unknown) => data, classroomStudentRecord: (data: unknown) => data }))
vi.mock('@/lib/server/contextual-classroom-home', () => ({ isContextualClassroomHomeAdmitted: mocks.homeAdmission, loadContextualClassroomHome: mocks.home }))
vi.mock('@/lib/server/classroom-experience-admission', () => ({ resolveClassroomExperienceAdmission: mocks.experienceAdmission }))
vi.mock('@/lib/server/classroom-home-visibility', () => ({ readClassroomHomeVisibility: mocks.visibility }))
vi.mock('@/lib/server/classroom-home-creation', () => ({ loadClassroomHomeCreationAccess: mocks.creation }))

const failure = { data: null, error: { message: 'PRIVATE DATABASE DETAIL' } }
const success = (data: unknown[]) => ({ data, error: null })
function query(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'order']) chain[method] = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}
async function indexProps() {
  const shell = await ClassroomsIndexPage() as ReactElement<{ children: ReactElement | ReactElement[] }>
  const children = Array.isArray(shell.props.children) ? shell.props.children : [shell.props.children]
  return children.find(child => child?.type === TeacherClassroomsIndex || child?.type === StudentClassroomsIndex)!.props as { initialReadError?: boolean; initialClassrooms: unknown[]; studentId?: string }
}

describe('classroom index required server reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 'owner-id', role: 'student', email: 'owner@example.test' })
    mocks.display.mockResolvedValue({})
    mocks.redirect.mockImplementation(() => { throw new Error('REDIRECT') })
    mocks.homeAdmission.mockReturnValue(false)
    mocks.experienceAdmission.mockReturnValue({ status: 'not-admitted' })
  })

  it('passes a generic failure status for a failed teacher list', async () => {
    mocks.user.mockResolvedValue({ id: 'owner-id', role: 'teacher' })
    mocks.teacher.mockResolvedValue(failure)
    expect(await indexProps()).toEqual({ initialClassrooms: [], initialReadError: true })
    expect(mocks.teacher).toHaveBeenCalledWith(expect.anything(), 'owner-id')
  })

  it('seeds the required shell clock when the student enrollment read fails', async () => {
    const serverNow = Date.parse('2026-10-06T03:59:59.000Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(serverNow)
    try {
      mocks.from.mockReturnValue(query(failure))
      const shell = await ClassroomsIndexPage() as ReactElement<{ initialNow: number }>
      expect(shell.props.initialNow).toBe(serverNow)
    } finally {
      now.mockRestore()
    }
  })

  it('does not mistake failed enrollment for a successful empty list or query classrooms', async () => {
    const enrollment = query(failure)
    mocks.from.mockReturnValue(enrollment)
    expect(await indexProps()).toEqual({ initialClassrooms: [], initialReadError: true, studentId: 'owner-id' })
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('classroom_enrollments')
    expect(enrollment.eq).toHaveBeenCalledWith('student_id', 'owner-id')
  })

  it('handles classroom-list failure after enrollment succeeds and recovers on a later read', async () => {
    const enrollments = [{ classroom_id: 'classroom-id' }]
    const classrooms = [{ id: 'classroom-id', title: 'Recovered' }]
    const classroomQuery = query(failure)
    mocks.from.mockReturnValueOnce(query(success(enrollments))).mockReturnValueOnce(classroomQuery)
    expect((await indexProps()).initialReadError).toBe(true)
    expect(classroomQuery.in).toHaveBeenCalledWith('id', ['classroom-id'])
    expect(classroomQuery.is).toHaveBeenCalledWith('archived_at', null)
    mocks.from.mockReturnValueOnce(query(success(enrollments))).mockReturnValueOnce(query(success(classrooms)))
    expect(await indexProps()).toEqual({ initialClassrooms: classrooms, initialReadError: false, studentId: 'owner-id' })
  })

  it('preserves successful student zero enrollments as empty', async () => {
    mocks.from.mockReturnValue(query(success([])))
    expect(await indexProps()).toEqual({ initialClassrooms: [], studentId: 'owner-id' })
    expect(mocks.from).toHaveBeenCalledOnce()
  })

  it('preserves successful teacher lists and successful zero results', async () => {
    mocks.user.mockResolvedValue({ id: 'owner-id', role: 'teacher' })
    mocks.teacher.mockResolvedValueOnce(success([{ id: 'classroom-id' }])).mockResolvedValueOnce(success([]))
    expect((await indexProps()).initialClassrooms).toEqual([{ id: 'classroom-id' }])
    expect(await indexProps()).toEqual({ initialClassrooms: [], initialReadError: false })
  })

  it('keeps the unauthenticated redirect ahead of classroom reads', async () => {
    mocks.user.mockResolvedValue(null)
    await expect(ClassroomsIndexPage()).rejects.toThrow('REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/login')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.teacher).not.toHaveBeenCalled()
  })

  it.each(['teacher', 'student'])('renders the same live home for admitted %s accounts without changing session identity', async (role) => {
    mocks.user.mockResolvedValue({ id: 'actor', role })
    mocks.homeAdmission.mockReturnValue(true)
    mocks.experienceAdmission.mockReturnValue({ status: 'admitted' })
    mocks.teacher.mockResolvedValue(success([{ id: 'owned' }]))
    mocks.home.mockResolvedValue({ owned: [{ id: 'owned' }], joined: [
      { id: 'visible', enrollment_id: 'membership-a' }, { id: 'hidden', enrollment_id: 'membership-b' },
    ] })
    mocks.visibility.mockResolvedValue({ actor_id: 'actor', hidden_enrollment_ids: ['membership-b'] })
    mocks.creation.mockResolvedValue({ canCreate: true })
    const shell = await ClassroomsIndexPage() as ReactElement<{ user: { id: string; role: string }; children: ReactElement }>
    expect(shell.props.user).toMatchObject({ id: 'actor', role })
    expect(shell.props.children.type).toBe(TeacherClassroomsIndex)
    expect(shell.props.children.props).toMatchObject({
      initialClassrooms: [{ id: 'owned' }],
      contextualHome: { joined: [{ id: 'visible', enrollment_id: 'membership-a' }], hidden: [{ id: 'hidden', enrollment_id: 'membership-b' }], canCreate: true, canImportBlueprint: role === 'teacher' },
    })
    expect(mocks.teacher).not.toHaveBeenCalled()
  })

  it('does not fall back to a role-based list when live persistence is unavailable', async () => {
    mocks.homeAdmission.mockReturnValue(true)
    mocks.experienceAdmission.mockReturnValue({ status: 'admitted' })
    mocks.teacher.mockResolvedValue(success([]))
    mocks.home.mockResolvedValue({ owned: [], joined: [] })
    mocks.creation.mockResolvedValue({ canCreate: false })
    mocks.visibility.mockRejectedValue(new Error('PRIVATE DETAIL'))
    expect(await indexProps()).toMatchObject({ initialClassrooms: [], initialReadError: true, contextualHome: { joined: [], hidden: [], canCreate: false } })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
