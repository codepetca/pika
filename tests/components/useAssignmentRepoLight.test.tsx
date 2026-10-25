import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAssignmentRepoLight } from '@/components/assignment-workspace/useAssignmentRepoLight'
import wireFixture from '../unit/repolight/fixture.json'

const runId = '11111111-1111-4111-8111-111111111111'
const source = {available:true,repositoryUrl:'https://github.com/sample-student/sky-hop',githubUsername:null,usernameProvenance:'none',requirementId:null,period:null,periodDefaulted:true,notice:null}
const run = {id:runId,status:'completed',sourceCurrent:true,canAdvance:false,canImport:true,reportAvailable:true,errorCode:null,nextRetryAt:null}
const reply = (payload: unknown,ok = true) => ({ok,json:async()=>payload})
function Harness({studentId = 'student-1',active = true,paused = false,selectedRequirementId,accept = vi.fn(),finish = vi.fn()}: {studentId?:string;active?:boolean;paused?:boolean;selectedRequirementId?:string;accept?:ReturnType<typeof vi.fn>;finish?:ReturnType<typeof vi.fn>}) {
  const state = useAssignmentRepoLight({classroomId:'classroom-1',assignmentId:'assignment-1',studentId,active,paused,selectedRequirementId,beginImport:()=>({expectedDocUpdatedAt:'2026-10-24T10:00:00Z',accept,finish})})
  return <div><span>{state.context?.state || 'unread'}</span><span>{state.run?.status}</span><span role="status">{state.error}</span><button onClick={()=>{void state.analyze()}}>Analyze</button><button onClick={()=>{void state.openReport()}}>Report</button><button onClick={()=>{void state.importFeedback('repository','Reviewed append text.').catch(()=>undefined)}}>Import</button>{state.report && <p>Report loaded</p>}</div>
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()})

describe('useAssignmentRepoLight',()=>{
  it('reads only after disclosure, restores persisted runs and keeps admission IDs stable on uncertain retry',async()=>{
    let attempts = 0
    const fetchMock = vi.fn(async (url:string,options?:RequestInit)=>{
      if (options?.method === 'POST') {attempts += 1;return reply(attempts === 1 ? {error:'connection_uncertain'} : {run},attempts !== 1)}
      return reply({state:'ready',source,run:null})
    })
    vi.stubGlobal('fetch',fetchMock)
    const {rerender} = render(<Harness active={false} />)
    expect(fetchMock).not.toHaveBeenCalled()
    rerender(<Harness />)
    await screen.findByText('ready')
    fireEvent.click(screen.getByText('Analyze'))
    await screen.findByText('connection uncertain')
    fireEvent.click(screen.getByText('Analyze'))
    await waitFor(()=>expect(attempts).toBe(2))
    const posts = fetchMock.mock.calls.filter(([,options])=>options?.method === 'POST').map(([,options])=>JSON.parse(String(options?.body)))
    expect(posts[0].requestId).toBe(posts[1].requestId)
    expect(posts[0]).not.toHaveProperty('githubUsername')
  })

  it('uses the acknowledged document revision and report digest, preserving import IDs after a lost response',async()=>{
    const accept = vi.fn(),finish = vi.fn()
    let imports = 0
    const fetchMock = vi.fn(async (url:string,options?:RequestInit)=>{
      if (url.endsWith('/import')) {imports += 1;if (imports === 1) throw new TypeError('Lost response');return reply({imported:true,replayed:true,doc:{id:'22222222-2222-4222-8222-222222222222',assignment_id:'33333333-3333-4333-8333-333333333333',student_id:'44444444-4444-4444-8444-444444444444',updated_at:'2026-10-24T11:00:00Z',teacher_feedback_draft:'Existing\n\nReviewed append text.',teacher_feedback_draft_updated_at:'2026-10-24T11:00:00Z'}})}
      if (url.endsWith('/report')) return reply({run,report:{reportDigest:'a'.repeat(64),bundle:wireFixture.bundle}})
      return reply({state:'ready',source,run})
    })
    vi.stubGlobal('fetch',fetchMock)
    render(<Harness accept={accept} finish={finish} />)
    await screen.findByText('completed')
    fireEvent.click(screen.getByText('Report'))
    await screen.findByText('Report loaded')
    fireEvent.click(screen.getByText('Import'))
    await waitFor(()=>expect(finish).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('Import'))
    await waitFor(()=>expect(accept).toHaveBeenCalledTimes(1))
    const posts = fetchMock.mock.calls.filter(([url])=>url.endsWith('/import')).map(([,options])=>JSON.parse(String(options?.body)))
    expect(posts[0]).toMatchObject({scopeKey:'repository',expectedDocUpdatedAt:'2026-10-24T10:00:00Z',expectedReportDigest:'a'.repeat(64),feedbackText:'Reviewed append text.'})
    expect(posts[0].requestId).toBe(posts[1].requestId)
    expect(finish).toHaveBeenCalledTimes(2)
  })

  it('ignores an old owner response and permits safe refreshes during write suspension',async()=>{
    let release: ((value:unknown)=>void) | undefined
    const fetchMock = vi.fn(async (url:string)=>url.includes('student-1') ? new Promise(resolve=>{release = resolve}) : reply({state:'not_configured',source,run:null}))
    vi.stubGlobal('fetch',fetchMock)
    const {rerender,unmount} = render(<Harness />)
    await waitFor(()=>expect(release).toBeTypeOf('function'))
    rerender(<Harness studentId="student-2" />)
    await screen.findByText('not_configured')
    await act(async()=>{release!(reply({state:'ready',source,run}))})
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    rerender(<Harness studentId="student-2" paused />)
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000)})
    expect(screen.getByText('not_configured')).toBeInTheDocument()
    unmount()
  })

  it('advances at most once per poll cycle and backs off until unmount',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    let advances = 0
    const running = {...run,status:'running',canAdvance:true,reportAvailable:false,canImport:false}
    const fetchMock = vi.fn(async (url:string)=>{
      if (url.endsWith('/advance')) {advances += 1;return reply({run:{...running,canAdvance:false}})}
      return reply(url.endsWith('/runs') ? {state:'ready',source,run:running} : {run:running})
    })
    vi.stubGlobal('fetch',fetchMock)
    let mounted: ReturnType<typeof render>
    await act(async()=>{mounted = render(<Harness />)})
    expect(advances).toBe(0)
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
    expect(advances).toBe(1)
    await act(async()=>{await vi.advanceTimersByTimeAsync(1999)})
    expect(advances).toBe(1)
    mounted!.unmount()
    const count = fetchMock.mock.calls.length
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000)})
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })
  it('requires an explicit artifact choice and binds uncertain admission retries to that choice',async()=>{
    const choice = '55555555-5555-4555-8555-555555555555'
    const choices = [{requirementId:'66666666-6666-4666-8666-666666666666',repositoryUrl:'https://github.com/fixture/first',label:'First repo'},{requirementId:choice,repositoryUrl:'https://github.com/fixture/second',label:'Second repo'}]
    let attempts = 0
    const fetchMock = vi.fn(async(_url:string,options?:RequestInit)=>{
      if (options?.method === 'POST') {attempts += 1;return reply(attempts === 1 ? {error:'connection_uncertain'} : {run},attempts !== 1)}
      return reply({state:'ready',source:{...source,available:false,notice:'repolight_requirement_required',repositoryChoices:choices},run:null})
    })
    vi.stubGlobal('fetch',fetchMock)
    const {rerender} = render(<Harness />)
    await screen.findByText('ready')
    fireEvent.click(screen.getByText('Analyze'))
    expect(attempts).toBe(0)
    rerender(<Harness selectedRequirementId={choice} />)
    await screen.findByText('ready')
    fireEvent.click(screen.getByText('Analyze'))
    await screen.findByText('connection uncertain')
    fireEvent.click(screen.getByText('Analyze'))
    await waitFor(()=>expect(attempts).toBe(2))
    const posts = fetchMock.mock.calls.filter(([,options])=>options?.method === 'POST').map(([,options])=>JSON.parse(String(options?.body)))
    expect(posts[0].requirementId).toBe(choice)
    expect(posts[0].requestId).toBe(posts[1].requestId)
  })

  it('invalidates an older report response when the selected artifact changes',async()=>{
    let release: ((value:unknown)=>void) | undefined
    const fetchMock = vi.fn(async(url:string)=>url.endsWith('/report') ? new Promise(resolve=>{release = resolve}) : reply({state:'ready',source,run}))
    vi.stubGlobal('fetch',fetchMock)
    const {rerender} = render(<Harness />)
    await screen.findByText('completed')
    fireEvent.click(screen.getByText('Report'))
    await waitFor(()=>expect(release).toBeTypeOf('function'))
    rerender(<Harness selectedRequirementId="55555555-5555-4555-8555-555555555555" />)
    await act(async()=>{release!(reply({run,report:{reportDigest:'a'.repeat(64),bundle:wireFixture.bundle}}))})
    expect(screen.queryByText('Report loaded')).not.toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
  })

  it.each(['disabled','not_configured'])('opens a cached report while configuration is %s without posting',async state=>{
    const fetchMock = vi.fn(async(url:string,_options?:RequestInit)=>reply(url.endsWith('/report') ? {run,report:{reportDigest:'a'.repeat(64),bundle:wireFixture.bundle}} : {state,source,run}))
    vi.stubGlobal('fetch',fetchMock)
    render(<Harness />)
    await screen.findByText(state)
    fireEvent.click(screen.getByText('Report'))
    await screen.findByText('Report loaded')
    fireEvent.click(screen.getByText('Analyze'))
    fireEvent.click(screen.getByText('Import'))
    await act(async()=>{})
    expect(fetchMock.mock.calls.some(([,options])=>(options as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('allows cached GETs while mutations are paused and never advances or imports',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    const activeRun = {...run,status:'running',canAdvance:true}
    const fetchMock = vi.fn(async(url:string,_options?:RequestInit)=>reply(url.endsWith('/report') ? {run:activeRun,report:{reportDigest:'a'.repeat(64),bundle:wireFixture.bundle}} : url.endsWith('/runs') ? {state:'ready',source,run:activeRun} : {run:activeRun}))
    vi.stubGlobal('fetch',fetchMock)
    await act(async()=>{render(<Harness paused />)})
    expect(screen.getByText('ready')).toBeInTheDocument()
    await act(async()=>{fireEvent.click(screen.getByText('Report'))})
    expect(screen.getByText('Report loaded')).toBeInTheDocument()
    await act(async()=>{fireEvent.click(screen.getByText('Analyze'));fireEvent.click(screen.getByText('Import'));await vi.advanceTimersByTimeAsync(8000)})
    expect(fetchMock.mock.calls.some(([,options])=>(options as RequestInit | undefined)?.method === 'POST')).toBe(false)
    expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/report'))).toBe(true)
  })

})
