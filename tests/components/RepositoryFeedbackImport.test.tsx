import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeacherStudentWorkController } from '@/components/assignment-workspace/useTeacherStudentWorkController'
import type { StudentWorkData } from '@/components/assignment-workspace/types'

const revision = '2026-10-24T10:00:00Z'
function work(studentId: string,returned = false): StudentWorkData {
  return {
    assignment:{id:'assignment-1',classroom_id:'classroom-1',title:'Fixture assignment',due_at:null,is_draft:false,submission_requirements:[]},
    classroom:{id:'classroom-1',title:'Fixture classroom'},student:{id:studentId,name:studentId,email:'fixture@example.invalid'},
    doc:{id:`doc-${studentId}`,assignment_id:'assignment-1',student_id:studentId,content:{type:'doc',content:[]},repo_url:null,github_username:null,is_submitted:true,submitted_at:revision,viewed_at:null,score_completion:2,score_thinking:3,score_workflow:4,feedback:null,teacher_feedback_draft:`Existing ${studentId} draft.`,teacher_feedback_draft_updated_at:revision,feedback_returned_at:null,ai_feedback_suggestion:null,ai_feedback_suggested_at:null,ai_feedback_model:null,teacher_cleared_at:null,graded_at:null,graded_by:null,returned_at:returned ? revision : null,authenticity_score:null,authenticity_flags:null,created_at:revision,updated_at:revision},
    status:'submitted',feedback_entries:[],repo_target:{target:null,submittedRepoUrl:null,submittedGitHubUsername:null,effectiveRepoUrl:null,effectiveGitHubUsername:null,repoOwner:null,repoName:null,selectionMode:'auto',validationStatus:'missing',validationMessage:null,latest_result:null},
  } as StudentWorkData
}
function setup(returned = false) {
  const fetchMock = vi.fn(async (url: string)=>({ok:true,json:async()=>url.includes('/history') ? {history:[]} : work(url.match(/students\/([^/?]+)/)?.[1] || 'student-1',returned)}))
  vi.stubGlobal('fetch',fetchMock)
  const hook = renderHook(({studentId})=>useTeacherStudentWorkController({classroomId:'classroom-1',assignmentId:'assignment-1',studentId}),{initialProps:{studentId:'student-1'}})
  return {...hook,fetchMock}
}
const ack = (studentId = 'student-1') => ({id:`doc-${studentId}`,assignment_id:'assignment-1',student_id:studentId,updated_at:'2026-10-24T11:00:00Z',teacher_feedback_draft:`Existing ${studentId} draft.\n\nImported rule feedback.`,teacher_feedback_draft_updated_at:'2026-10-24T11:00:00Z'})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('repository feedback acknowledgement boundary',()=>{
  it('requires a clean acknowledged draft and never starts a grade save to prepare import',async()=>{
    const {result,fetchMock} = setup()
    await waitFor(()=>expect(result.current.readState).toBe('ready'))
    expect(result.current.canImportRepositoryFeedback).toBe(true)
    act(()=>result.current.setFeedbackDraft('Unsaved local draft.'))
    expect(result.current.canImportRepositoryFeedback).toBe(false)
    expect(()=>result.current.beginRepositoryFeedbackImport()).toThrow(/Wait for your draft to save/)
    expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/grade'))).toBe(false)
    expect(result.current.feedbackDraft).toBe('Unsaved local draft.')
  })

  it('applies only the comment acknowledgement and preserves all score values and draft mode',async()=>{
    const {result,fetchMock} = setup()
    await waitFor(()=>expect(result.current.readState).toBe('ready'))
    const mode = result.current.gradeMode
    let session: ReturnType<typeof result.current.beginRepositoryFeedbackImport>
    act(()=>{session = result.current.beginRepositoryFeedbackImport()})
    expect(session!.expectedDocUpdatedAt).toBe(revision)
    expect(result.current.repositoryImporting).toBe(true)
    act(()=>{session!.accept(ack());session!.finish()})
    expect(result.current.feedbackDraft).toBe(ack().teacher_feedback_draft)
    expect([result.current.scoreCompletion,result.current.scoreThinking,result.current.scoreWorkflow]).toEqual(['2','3','4'])
    expect(result.current.gradeMode).toBe(mode)
    expect(result.current.canImportRepositoryFeedback).toBe(true)
    expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/grade') || url.endsWith('/feedback-return'))).toBe(false)
  })

  it('retains a new local edit made during import instead of applying a late acknowledgement',async()=>{
    const {result} = setup()
    await waitFor(()=>expect(result.current.readState).toBe('ready'))
    let session: ReturnType<typeof result.current.beginRepositoryFeedbackImport>
    act(()=>{session = result.current.beginRepositoryFeedbackImport()})
    act(()=>result.current.setFeedbackDraft('New local text despite the UI guard.'))
    expect(()=>session!.accept(ack())).toThrow(/Your local draft is kept/)
    act(()=>session!.finish())
    expect(result.current.feedbackDraft).toBe('New local text despite the UI guard.')
    expect(result.current.canImportRepositoryFeedback).toBe(false)
  })

  it('rejects returned work and late acknowledgements after navigation',async()=>{
    const returned = setup(true)
    await waitFor(()=>expect(returned.result.current.readState).toBe('ready'))
    expect(returned.result.current.canImportRepositoryFeedback).toBe(false)
    expect(()=>returned.result.current.beginRepositoryFeedbackImport()).toThrow()
    returned.unmount()
    const current = setup()
    await waitFor(()=>expect(current.result.current.readState).toBe('ready'))
    let session: ReturnType<typeof current.result.current.beginRepositoryFeedbackImport>
    act(()=>{session = current.result.current.beginRepositoryFeedbackImport()})
    current.rerender({studentId:'student-2'})
    await waitFor(()=>expect(current.result.current.data?.student.id).toBe('student-2'))
    expect(()=>session!.accept(ack())).toThrow(/Student work changed/)
    act(()=>session!.finish())
    expect(current.result.current.feedbackDraft).toBe('Existing student-2 draft.')
  })
})
