/** Closed source-only Survey successor. Importing grants no execution authority. */
import assert from 'node:assert/strict'
import { types } from 'node:util'
import type { Page, Response } from '@playwright/test'
import type { ActorLabel, RehearsalPlan } from './contextual-test-rehearsal'

export const surveyScope = 'survey-workflow-v1' as const
export const surveyActors = ['ownerTeacher', 'ownerStudent', 'memberStudent', 'memberTeacher', 'nonmember', 'memberTeacher', 'memberStudent'] as const
export const surveyScreens = (['owner-teacher', 'owner-student', 'member-student', 'member-teacher'] as const).flatMap((cell) =>
  (['light', 'dark'] as const).flatMap(theme => (['desktop', 'mobile'] as const).map(viewport => ({
    label: `survey-${cell}-${viewport}-${theme}`,
    actor: ({ 'owner-teacher': 'ownerTeacher', 'owner-student': 'ownerStudent', 'member-student': 'memberStudent', 'member-teacher': 'memberTeacher' } as const)[cell],
    viewport, theme,
  }))))
export const surveyLabels = surveyScreens.map(screen => screen.label)
export const surveyStages = ['admission', 'owner-create', 'owner-author', 'owner-reload', 'owner-preview', 'owner-publish',
  'owner-scratch', 'owner-cross-class', 'member-respond', 'member-results', 'owner-results', 'static-duplicate',
  'dynamic-update', 'visibility', 'future-opening', 'close-reopen', 'denials', 'archive', 'revocation', 'final-readback', 'captures'] as const
export type SurveyStage = typeof surveyStages[number]
export function surveyFailureStage(error: unknown): SurveyStage | null {
  if (!error || typeof error !== 'object' || types.isProxy(error)) return null
  const message = Object.getOwnPropertyDescriptor(error, 'message')
  if (!message || !('value' in message) || typeof message.value !== 'string') return null
  const prefix = 'Contextual Survey failed: '
  return message.value.startsWith(prefix) ? surveyStages.find(stage => stage === message.value.slice(prefix.length)) ?? null : null
}
export type SurveyRuntime = {
  plan: RehearsalPlan
  withActor(actor: ActorLabel, callback: (page: Page) => Promise<void>): Promise<void>
  api<T>(page: Page, method: string, path: string, body?: unknown, expectedStatus?: number): Promise<T>
  response<T>(page: Page, response: Response): Promise<T>
  navigate(page: Page, url: string): Promise<void>
  check(): void
  snapshot(label: string, page: Page): Promise<void>
}
export type SurveyIdentity = { surveyId: string; classroomId: string; ownerId: string; title: string; questionIds: [string, string] }
export type SurveyTextResult = { response_id: string; response_text: string; submitted_at: string; updated_at: string }
export type SurveyAggregate = { question_id: string; question_type: string; question_text: string; options: string[];
  counts: number[]; total_responses: number; responses: Array<SurveyTextResult & { student_id?: string; name?: string | null; email?: string | null }> }
export type SurveyResults = { survey: { id: string; title: string; status: string; show_results: boolean; dynamic_responses: boolean };
  results: SurveyAggregate[]; questions?: unknown[]; responders?: Array<{ student_id: string; name: string | null; email: string }>;
  stats?: { total_students: number; responded: number } }
export type SurveyExchange = { label: string; actor: ActorLabel; via: 'screen' | 'permission-fixture' | 'denied-probe';
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; status: number; request: unknown; response: unknown }
export type SurveySubmission = { surveyId: string; actor: ActorLabel; studentId: string; initial: SurveyTextResult; final: SurveyTextResult }
export type SurveyWorkflowResult = {
  surveys: [SurveyIdentity, SurveyIdentity]
  deleted: Array<{ surveyId: string; classroomId: string; questionIds: [string, string] }>
  submissions: SurveySubmission[]
  archive: { before: SurveyResults; after: SurveyResults }
  denials: { before: [SurveyResults, SurveyResults]; after: [SurveyResults, SurveyResults] }
  exchanges: SurveyExchange[]
}
export const surveyText = (actor: ActorLabel, updated = false) => `Synthetic Survey ${actor}${updated ? ' updated' : ''}: Beta helped me learn.`
export const surveyTitles = ['Contextual Survey A', 'Contextual Survey B'] as const
export const surveyPrompt = { mc: 'Which activity helped you learn?', text: 'What should we explore next?', link: 'Share a learning link.' } as const
export const surveyExchangeLabels = [
  'create-A', 'publish-A', 'create-scratch-A', 'publish-scratch-A',
  'create-B', 'publish-B', 'create-scratch-B', 'publish-scratch-B',
  'cross-ownerTeacher', 'cross-ownerStudent', 'scratch-submit-A', 'scratch-submit-B',
  'delete-question-A', 'delete-scratch-A', 'delete-question-B', 'delete-scratch-B', 'submit-memberStudent', 'static-duplicate',
  'submit-memberTeacher', 'self-owner', 'foreign-owner', 'foreign-question', 'foreign-class', 'member-owner', 'nonmember-detail', 'nonmember-results',
  'dynamic-enabled', 'dynamic-update', 'hide-results', 'hidden-results', 'show-results', 'future-opening', 'future-response', 'restore-opening',
  'close', 'closed-response', 'reopen', 'archive', 'archived-cached-detail', 'archived-cached-response', 'archived-cached-results',
  'archived-owner-read', 'archived-owner-write', 'archived-fresh-detail', 'archived-fresh-response', 'unarchive',
  'remove-member', 'revoked-cached-detail', 'revoked-cached-response', 'revoked-cached-results', 'revoked-fresh-detail', 'revoked-fresh-response',
] as const
/** Validate fresh selected results, never accept an aggregate for another Survey. */
export function assertSurveyResults(raw: SurveyResults, identity: SurveyIdentity, member = false): void {
  assert(raw?.survey?.id === identity.surveyId && raw.survey.title === identity.title && raw.results.length === 2)
  assert.deepEqual(raw.results.map(row => row.question_id), identity.questionIds)
  assert(raw.results[0].question_type === 'multiple_choice' && raw.results[1].question_type === 'short_text')
  assert.deepEqual(raw.results[0].options, ['Alpha', 'Beta'])
  assert(raw.results.every(row => Number.isSafeInteger(row.total_responses) && row.total_responses >= 0))
  if (member) {
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        assert(!['student_id', 'name', 'email', 'responders'].includes(key)); walk(child)
      }
    }
    walk(raw)
  } else {
    assert(raw.stats?.total_students === 3 && raw.stats.responded === raw.results[0].total_responses)
    assert(raw.responders?.length === raw.stats.responded)
    assert(!raw.responders.some(row => row.student_id === identity.ownerId))
  }
}
export function assertSurveySubmissionPreserved(before: SurveyTextResult, after: SurveyTextResult, actor: ActorLabel, updated: boolean): void {
  assert(before.response_id === after.response_id && before.submitted_at === after.submitted_at)
  assert(before.response_text === surveyText(actor) && after.response_text === surveyText(actor, updated))
  for (const value of [before.submitted_at, before.updated_at, after.submitted_at, after.updated_at]) assert(Number.isFinite(Date.parse(value)))
  assert(Date.parse(after.updated_at) >= Date.parse(before.updated_at))
}
