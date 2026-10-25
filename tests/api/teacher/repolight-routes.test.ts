import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ role: vi.fn(), source: vi.fn(), begin: vi.fn(), context: vi.fn(), run: vi.fn(), advance: vi.fn(), report: vi.fn(), importFeedback: vi.fn(), readJson: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/server/assignment-repolight-runs', () => ({ loadAssignmentRepoLightSource: mocks.source, beginAssignmentRepoLightRun: mocks.begin, getAssignmentRepoLightContext: mocks.context, getAssignmentRepoLightRun: mocks.run, advanceAssignmentRepoLightRun: mocks.advance, getAssignmentRepoLightReport: mocks.report, readRepoLightRequestJson: mocks.readJson }))
vi.mock('@/lib/server/assignment-repolight-import', () => ({ importAssignmentRepoLightFeedback: mocks.importFeedback }))
import { ApiError } from '@/lib/api-error'
import { GET, POST } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/route'
import { GET as readReport } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/report/route'
import { POST as advance } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/advance/route'
import { POST as importFeedback } from '@/app/api/teacher/assignments/[id]/students/[studentId]/repolight/runs/[runId]/import/route'
const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
const context = () => ({ params: Promise.resolve({ id: uuid(2), studentId: uuid(5) }) })
const runContext = () => ({ params: Promise.resolve({ id: uuid(2), studentId: uuid(5), runId: uuid(20) }) })
const req = () => new NextRequest('https://pika.example.test/api/teacher/assignments/test/repolight/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
beforeEach(() => { vi.clearAllMocks(); mocks.role.mockResolvedValue({ id: uuid(1), role: 'teacher' }); mocks.source.mockResolvedValue({}); mocks.readJson.mockResolvedValue({ requestId: uuid(20) }); mocks.begin.mockResolvedValue({ id: uuid(20) }) })
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
