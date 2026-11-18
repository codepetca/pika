import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssignmentRepoLight } from '@/components/assignment-workspace/useAssignmentRepoLight'
import fixture from '../unit/repolight/fixture.json'

const requests = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/request-cache', () => ({
  fetchJSON: requests.read,
  fetchJSONWithCache: (_key: string, fetcher: () => Promise<unknown>) => fetcher(),
}))

const run = {id:'40000000-0000-4000-8000-000000000001',status:'completed',sourceCurrent:true,canAdvance:false,canImport:true,reportAvailable:true,errorCode:null,nextRetryAt:null}
const source = {available:true,repositoryUrl:'https://github.com/sample-student/sky-hop',githubUsername:null,usernameProvenance:'none',requirementId:null,period:null,periodDefaulted:true,notice:null}
const context = {state:'ready',source,run}
const args = {classroomId:'classroom',assignmentId:'assignment',studentId:'student',active:true,paused:false,beginImport:vi.fn()}
beforeEach(() => requests.read.mockReset())

describe('repository feedback availability', () => {
  it.each(['no run','failed'] as const)('finishes a refresh with %s and never keeps stale import access', async outcome => {
    let finish!: (value: unknown) => void
    let fail!: (reason: Error) => void
    const pending = new Promise((resolve,reject) => { finish = resolve; fail = reject })
    requests.read.mockResolvedValueOnce(context).mockResolvedValueOnce({run,report:{reportDigest:'a'.repeat(64),bundle:fixture.bundle}}).mockReturnValueOnce(pending)
    const {result} = renderHook(() => useAssignmentRepoLight(args))
    await waitFor(() => expect(result.current.run?.id).toBe(run.id))
    await act(async () => { await result.current.openReport() })
    expect(result.current.report).not.toBeNull()
    act(() => result.current.refreshStatus())
    await waitFor(() => expect(result.current.checking).toBe(true))
    await act(async () => { await result.current.analyze() })
    expect(requests.read).toHaveBeenCalledTimes(3)
    await act(async () => outcome === 'no run' ? finish({...context,run:null}) : fail(new Error('Refresh failed')))
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.run).toBeNull()
    expect(result.current.report).not.toBeNull()
    if (outcome === 'failed') expect(result.current.error).toBe('Refresh failed')
    await expect(result.current.importFeedback('repository','text')).rejects.toThrow('stale or unavailable')
    expect(args.beginImport).not.toHaveBeenCalled()
  })
})
