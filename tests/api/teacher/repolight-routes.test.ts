import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), source: vi.fn(), begin: vi.fn(), context: vi.fn(), run: vi.fn(), advance: vi.fn(), report: vi.fn(), importFeedback: vi.fn(), readJson: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/server/assignment-repolight-runs', () => ({ loadAssignmentRepoLightSource: mocks.source, beginAssignmentRepoLightRun: mocks.begin, getAssignmentRepoLightContext: mocks.context, getAssignmentRepoLightRun: mocks.run, advanceAssignmentRepoLightRun: mocks.advance, getAssignmentRepoLightReport: mocks.report, readRepoLightRequestJson: mocks.readJson }))
vi.mock('@/lib/server/assignment-repolight-import', () => ({ importAssignmentRepoLightFeedback: mocks.importFeedback }))
import { ApiError } from '@/lib/api-error'
import { GET, POST } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/route'
import { GET as readRun } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/route'
import { GET as readReport } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/report/route'
import { POST as advance } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/advance/route'
import { POST as importFeedback } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/import/route'
const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
const context = () => ({ params: Promise.resolve({ id: uuid(2), studentId: uuid(5) }) })
const runContext = () => ({ params: Promise.resolve({ id: uuid(2), studentId: uuid(5), runId: uuid(20) }) })
const req = () => new NextRequest('https://pika.example.test/api/teacher/assignments/test/repolight/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
const importInput = { requestId: uuid(25), scopeKey: 'repository', expectedDocUpdatedAt: '2026-10-24T12:00:00Z', expectedReportDigest: 'a'.repeat(64) }
const routeCases = [
  { name: 'context GET', invoke: () => GET(req(), context()), service: mocks.context, write: false, status: 200 },
  { name: 'begin POST', invoke: () => POST(req(), context()), service: mocks.begin, write: true, status: 202 },
  { name: 'status GET', invoke: () => readRun(req(), runContext()), service: mocks.run, write: false, status: 200 },
  { name: 'advance POST', invoke: () => { mocks.readJson.mockResolvedValue({}); return advance(req(), runContext()) }, service: mocks.advance, write: true, status: 200 },
  { name: 'report GET', invoke: () => readReport(req(), runContext()), service: mocks.report, write: false, status: 200 },
  { name: 'import POST', invoke: () => { mocks.readJson.mockResolvedValue(importInput); return importFeedback(req(), runContext()) }, service: mocks.importFeedback, write: true, status: 200 },
]
const admission = (ids = [uuid(1)]) => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: ids }))
const services = [mocks.source, mocks.begin, mocks.context, mocks.run, mocks.advance, mocks.report, mocks.importFeedback, mocks.readJson]
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
  mocks.auth.mockResolvedValue({ id: uuid(1), role: 'teacher' })
  mocks.role.mockImplementation(async () => {
    const user = await mocks.auth()
    if (user.role !== 'teacher') throw new ApiError(403, 'Forbidden')
    return user
  })
  mocks.source.mockResolvedValue({}); mocks.readJson.mockResolvedValue({ requestId: uuid(20) }); mocks.begin.mockResolvedValue({ id: uuid(20) })
  mocks.context.mockResolvedValue({ state: 'ready', run: null }); mocks.run.mockResolvedValue({ id: uuid(20) }); mocks.advance.mockResolvedValue({ id: uuid(20) })
  mocks.report.mockResolvedValue({ run: { id: uuid(20) }, report: { bundle: {} } }); mocks.importFeedback.mockResolvedValue({ imported: true, replayed: false, doc: {} })
})
afterEach(() => vi.unstubAllEnvs())

describe.each(routeCases)('RepoLight actor admission: $name', route => {
  it.each(['student', 'teacher'])('forwards the admitted %s-labelled authenticated actor to the existing owner boundary', async role => {
    admission(); mocks.auth.mockResolvedValue({ id: uuid(1), role })
    const response = await route.invoke()
    expect(response.status).toBe(route.status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.role).not.toHaveBeenCalled()
    expect(route.service.mock.calls[0][0]).toBe(uuid(1))
    expect(route.service.mock.calls[0][1]).toEqual({ assignmentId: uuid(2), studentId: uuid(5) })
    if (route.write) expect(mocks.source.mock.invocationCallOrder[0]).toBeLessThan(mocks.readJson.mock.invocationCallOrder[0])
    else { expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled(); expect(mocks.importFeedback).not.toHaveBeenCalled() }
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [uuid(9)] })])('retains the legacy teacher fallback when admission is %s', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    expect((await route.invoke()).status).toBe(route.status)
    expect(mocks.role).toHaveBeenCalledExactlyOnceWith('teacher')
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [uuid(9)] })])('does not admit a student through dormant pair flags when shared admission is %s', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_PAIRS', JSON.stringify([{ userId: uuid(1), assignmentId: uuid(2) }]))
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS', JSON.stringify([{ userId: uuid(1), assignmentId: uuid(2) }]))
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS', JSON.stringify([{ userId: uuid(1), classroomId: uuid(2) }]))
    mocks.auth.mockResolvedValue({ id: uuid(1), role: 'student' })
    expect((await route.invoke()).status).toBe(403)
    for (const service of services) expect(service).not.toHaveBeenCalled()
  })

  it.each(['', 'broken', JSON.stringify({ version: 2, admittedUserIds: [uuid(1)] })])('fails closed before target/body access for malformed admission %j', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    expect((await route.invoke()).status).toBe(503)
    expect(mocks.auth).toHaveBeenCalledOnce(); expect(mocks.role).not.toHaveBeenCalled()
    for (const service of services) expect(service).not.toHaveBeenCalled()
  })

  it.each([undefined, 'broken'])('returns anonymous 401 before configuration or target/body checks: %s', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    expect((await route.invoke()).status).toBe(401)
    for (const service of services) expect(service).not.toHaveBeenCalled()
  })

  it.each([uuid(5), uuid(9)])('preserves current-owner denial for admitted learner/outsider %s', async actorId => {
    admission([actorId]); mocks.auth.mockResolvedValue({ id: actorId, role: 'student' })
    const boundary = route.write ? mocks.source : route.service
    boundary.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await route.invoke()).status).toBe(403)
    expect(boundary.mock.calls[0][0]).toBe(actorId)
    expect(mocks.readJson).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled(); expect(mocks.importFeedback).not.toHaveBeenCalled()
  })
})
describe('teacher report-only route boundaries', () => {
  it('requires the current teacher before reading params or body', async () => {
    mocks.role.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    expect((await POST(req(), context())).status).toBe(403)
    expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.readJson).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('denies a foreign owner before decoding input or beginning work', async () => {
    mocks.source.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await POST(req(), context())).status).toBe(403)
    expect(mocks.readJson).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('parses strict input only after owner authorization and returns projected run data', async () => {
    const response = await POST(req(), context())
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ run: { id: uuid(20) } }); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.source.mock.invocationCallOrder[0]).toBeLessThan(mocks.readJson.mock.invocationCallOrder[0])
    mocks.readJson.mockResolvedValue({ requestId: uuid(20), callbackUrl: 'https://attacker.test' })
    expect((await POST(req(), context())).status).toBe(400)
    expect(mocks.begin).toHaveBeenCalledTimes(1)
  })
  it('keeps GET context/report reads independent of advance/provider work', async () => {
    mocks.context.mockResolvedValue({ state: 'disabled', run: null }); mocks.report.mockResolvedValue({ run: { id: uuid(20) }, report: { bundle: {} } })
    expect((await GET(req(), context())).status).toBe(200)
    expect((await readReport(req(), runContext())).status).toBe(200)
    expect(mocks.advance).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('accepts only an empty explicit advance request and checks owner first', async () => {
    mocks.readJson.mockResolvedValue({}); mocks.advance.mockResolvedValue({ id: uuid(20) })
    expect((await advance(req(), runContext())).status).toBe(200)
    mocks.readJson.mockResolvedValue({ sourceRevision: 'forged' })
    expect((await advance(req(), runContext())).status).toBe(400)
    expect(mocks.advance).toHaveBeenCalledTimes(1)
  })
  it('uses the dedicated import path and forwards no grade or Return payload', async () => {
    mocks.readJson.mockResolvedValue({ requestId: uuid(25), scopeKey: 'repository', expectedDocUpdatedAt: '2026-10-24T12:00:00Z', expectedReportDigest: 'a'.repeat(64) })
    mocks.importFeedback.mockResolvedValue({ imported: true, replayed: false, doc: {} })
    expect((await importFeedback(req(), runContext())).status).toBe(200)
    expect(mocks.importFeedback.mock.calls[0][3]).not.toHaveProperty('score')
    expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled()
  })
})
