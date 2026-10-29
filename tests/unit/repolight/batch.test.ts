import { describe, expect, it, vi } from 'vitest'
import { executeRepoLightBatch, type RepoLightBatchStudent } from '@/lib/repolight-batch'
import wire from './fixture.json'

const assignmentId = '7b6b8299-bd4c-4d22-94a9-39fe4031b99c'
const firstId = 'b563d3cf-49a5-4e2a-9adc-deb288483424'
const secondId = '600b8b87-2dc1-4667-915b-dadcc61b5795'
const runId = 'a1e8af61-9404-42ba-8503-970c2469d472'
const revision = '2026-10-25T10:00:00.000Z'
const students: RepoLightBatchStudent[] = [{ studentId: firstId, expectedDocUpdatedAt: revision }, { studentId: secondId, expectedDocUpdatedAt: revision }]
const view = (status: 'queued' | 'completed') => ({ id: runId, status, sourceCurrent: true, canAdvance: status === 'queued', canImport: status === 'completed', reportAvailable: status === 'completed', errorCode: null, nextRetryAt: null })
const context = () => ({ state:'ready', source:{ repositoryChoices:[], available:true, repositoryUrl:'https://github.com/example/repo', githubUsername:'sample-student', usernameProvenance:'artifact', requirementId:null, period:null, periodDefaulted:false, notice:null }, run:null })
const bundle = () => ({ ...structuredClone(wire.bundle), selection:{status:'matched',requestedGithubLogin:'sample-student',contributorId:'github-sample-student',notice:null} })
const report = () => ({ run:view('completed'), report:{ reportDigest:'a'.repeat(64), bundle:bundle(), assignmentSummary:{scopeKey:'contributor:github-sample-student',text:'Assignment summary.',rulesVersion:'1.0.0'} } })

describe('RepoLight batch execution', () => {
  it('processes each target sequentially and imports only its own summary with its captured revision', async () => {
    const requests: {url:string; init:RequestInit}[] = []
    const request = vi.fn(async (url:string, init:RequestInit): Promise<unknown> => {
      requests.push({url,init})
      const id = url.includes(firstId) ? firstId : secondId
      if (url.endsWith('/import')) return { imported:true, replayed:false, doc:{id:runId, assignment_id:assignmentId, student_id:id, updated_at:revision,teacher_feedback_draft:'draft',teacher_feedback_draft_updated_at:revision} }
      if (url.endsWith('/report')) return report()
      if (url.endsWith('/advance')) return {run:view('completed')}
      if (url.endsWith(`/${runId}`)) return {run:view('queued')}
      if (init.method === 'POST') return {run:view('queued')}
      return context()
    })
    const onProgress = vi.fn()
    const out = await executeRepoLightBatch({ assignmentId, students, signal:new AbortController().signal, request, onProgress, sleep:async () => {}, newId:() => runId })
    expect(out.map(x => x.status)).toEqual(['imported','imported'])
    expect(requests.findIndex(r => r.url.includes(secondId))).toBeGreaterThan(requests.findIndex(r => r.url.includes(firstId) && r.url.endsWith('/import')))
    for (const item of requests.filter(r => r.url.endsWith('/import'))) expect(JSON.parse(item.init.body as string)).toMatchObject({ expectedDocUpdatedAt:revision, expectedReportDigest:'a'.repeat(64), scopeKey:'contributor:github-sample-student', feedbackText:'Assignment summary.' })
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({studentId:secondId,phase:'finished',result:expect.objectContaining({status:'imported'})}))
  })
  it('skips unavailable connection, ambiguous source, invalid username, and missing revision without posting', async () => {
    for (const mutate of [
      (v:ReturnType<typeof context>) => {v.state='not_configured'},
      (v:ReturnType<typeof context>) => {v.source.available=false},
      (v:ReturnType<typeof context>) => {v.source.githubUsername='not valid!'},
    ]) {
      const c = context(); mutate(c)
      const request = vi.fn(async () => c)
      const out = await executeRepoLightBatch({assignmentId,students:[students[0]],signal:new AbortController().signal,request})
      expect(out[0].status).toBe('skipped'); expect(request).toHaveBeenCalledTimes(1)
    }
    const request = vi.fn()
    const out = await executeRepoLightBatch({assignmentId,students:[{studentId:firstId,expectedDocUpdatedAt:null}],signal:new AbortController().signal,request})
    expect(out[0].status).toBe('skipped'); expect(request).not.toHaveBeenCalled()
  })
  it('does not import an unmatched report or retry an uncertain write', async () => {
    const request = vi.fn(async (url:string, init:RequestInit): Promise<unknown> => {
      if (url.endsWith('/report')) return {...report(), report:{...report().report, assignmentSummary:null}}
      if (init.method === 'POST') return {run:view('completed')}
      return context()
    })
    const result = await executeRepoLightBatch({assignmentId,students:[students[0]],signal:new AbortController().signal,request,newId:() => runId})
    expect(result[0].status).toBe('skipped'); expect(request.mock.calls.some(([url]) => url.endsWith('/import'))).toBe(false)
    const failing = vi.fn(async (_url:string, init:RequestInit) => {if (init.method === 'POST') throw new Error('network'); return context()})
    const failed = await executeRepoLightBatch({assignmentId,students:[students[0]],signal:new AbortController().signal,request:failing,newId:() => runId})
    expect(failed[0]).toMatchObject({status:'failed',reason:expect.stringContaining('uncertain')}); expect(failing).toHaveBeenCalledTimes(2)
  })
  it('stops further students after cancellation', async () => {
    const controller = new AbortController()
    const request = vi.fn(async () => { controller.abort(); throw new DOMException('Stopped','AbortError') })
    const result = await executeRepoLightBatch({assignmentId,students,signal:controller.signal,request})
    expect(result.map(x => x.status)).toEqual(['cancelled','cancelled']); expect(request).toHaveBeenCalledTimes(1)
  })
  it('does not retry an import when the captured document revision is rejected', async () => {
    const request = vi.fn(async (url:string, init:RequestInit): Promise<unknown> => {
      if (url.endsWith('/import')) throw new Error('Revision conflict')
      if (url.endsWith('/report')) return report()
      if (init.method === 'POST') return {run:view('completed')}
      return context()
    })
    const result = await executeRepoLightBatch({assignmentId,students:[students[0]],signal:new AbortController().signal,request,newId:() => runId})
    expect(result[0].status).toBe('failed')
    expect(request.mock.calls.filter(([url]) => url.endsWith('/import'))).toHaveLength(1)
  })
  it('does not append an unavailable assignment-date summary as student feedback', async () => {
    const request = vi.fn(async (url:string, init:RequestInit): Promise<unknown> => {
      if (url.endsWith('/report')) {
        const value = report()
        value.report.assignmentSummary.text = 'Assignment commit metrics are unavailable because assignment dates are unavailable or invalid. There is not enough information to calculate these metrics.'
        return value
      }
      if (init.method === 'POST') return {run:view('completed')}
      return context()
    })
    const result = await executeRepoLightBatch({assignmentId,students:[students[0]],signal:new AbortController().signal,request,newId:() => runId})
    expect(result[0]).toMatchObject({status:'skipped',reason:'Assignment metrics are unavailable.'})
    expect(request.mock.calls.some(([url]) => url.endsWith('/import'))).toBe(false)
  })
  it('skips an existing active run instead of superseding it', async () => {
    const request = vi.fn(async () => ({...context(),run:view('queued')}))
    const result = await executeRepoLightBatch({assignmentId,students:[students[0]],signal:new AbortController().signal,request})
    expect(result[0].status).toBe('skipped'); expect(request).toHaveBeenCalledTimes(1)
  })
})
