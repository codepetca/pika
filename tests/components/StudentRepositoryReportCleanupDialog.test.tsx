import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { StudentRepositoryReportCleanupDialog } from '@/components/StudentRepositoryReportCleanupDialog'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'

const classroomId='10000000-0000-4000-8000-000000000001'
const target={student_id:'20000000-0000-4000-8000-000000000001',generation_id:'30000000-0000-4000-8000-000000000001',email:'synthetic@example.invalid',name:'Synthetic student',scope:'provider_bound' as const,report_cleanup_available:true}
const operationId='40000000-0000-4000-8000-000000000001'
const pending={operation_id:operationId,scope:'repolight_only',academic_preserved:true,status:'provider_pending',pal:'out_of_scope',bara:'out_of_scope',local_status:'not_started',cleanup_completed:false,repolight_cleanup_pending:true,blockers:[]}
const done={...pending,status:'completed',cleanup_completed:true,repolight_cleanup_pending:false}
const reply=(body:unknown)=>new Response(JSON.stringify(body),{status:200})
const props={classroomId,classroomTitle:'Synthetic classroom',targets:[target],isOpen:true,onClose:vi.fn(),onReportsRemoved:vi.fn()}
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();invalidateCachedJSONMatching('live-cleanup:');vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId)})
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
async function select(){fireEvent.change(screen.getByRole('combobox',{name:'Removed student'}),{target:{value:target.generation_id}});await waitFor(()=>expect(screen.getByRole('button',{name:'Check progress'})).toBeEnabled())}

describe('report-only removed membership cleanup',()=>{
 it('requires explicit confirmation and scopes every POST while leaving academic/provider data unchanged',async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(reply({scope:'repolight_only',generation_id:target.generation_id,enabled:true,operation:null})).mockResolvedValueOnce(reply({operation:pending,enabled:true})).mockResolvedValueOnce(reply({operation:done,enabled:true}))
  vi.stubGlobal('fetch',fetchMock)
  render(<StudentRepositoryReportCleanupDialog {...props} />)
  expect(screen.getByRole('dialog',{name:'Remove repository reports'})).toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  await select()
  expect(fetchMock.mock.calls[0][0]).toContain('?scope=repolight_only')
  expect(screen.getByRole('button',{name:'Remove repository reports'})).toBeDisabled()
  expect(screen.getByText(/Classwork, grades, attendance, files, accounts and other provider activity are kept/)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox'),{target:{value:target.email}})
  fireEvent.click(screen.getByRole('button',{name:'Remove repository reports'}))
  await screen.findByText('Waiting for repository-report cleanup. Academic data and other provider activity are kept.')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({action:'reserve',scope:'repolight_only',confirmation:'REMOVE REPOSITORY REPORTS',generation_id:target.generation_id,operation_id:operationId})
  expect(props.onReportsRemoved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Continue report cleanup'}))
  await screen.findByText('Repository reports removed. Academic data and other provider activity are kept.')
  expect(props.onReportsRemoved).toHaveBeenCalledOnce()
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).operation_id).toBe(operationId)
  expect(screen.queryByText(/can now be added|fresh class data|Cleanup verified/)).not.toBeInTheDocument()
 })
 it('retains a read-only saved pending state without automatically advancing',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({scope:'repolight_only',generation_id:target.generation_id,enabled:false,operation:pending})))
  render(<StudentRepositoryReportCleanupDialog {...props} />);await select()
  expect(screen.getByRole('button',{name:'Continue report cleanup'})).toBeDisabled()
  expect(fetch).toHaveBeenCalledTimes(1)
 })
 it('ignores completion after the dialog is closed',async()=>{
  let release:((reply:Response)=>void)|undefined
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(reply({scope:'repolight_only',generation_id:target.generation_id,enabled:true,operation:null})).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve})))
  const view=render(<StudentRepositoryReportCleanupDialog {...props} />);await select()
  fireEvent.change(screen.getByRole('textbox'),{target:{value:target.email}});fireEvent.click(screen.getByRole('button',{name:'Remove repository reports'}))
  await waitFor(()=>expect(release).toBeTypeOf('function'))
  view.rerender(<StudentRepositoryReportCleanupDialog {...props} isOpen={false} />)
  await act(async()=>{release!(reply({operation:done,enabled:true}))})
  expect(props.onReportsRemoved).not.toHaveBeenCalled()
 })
})
