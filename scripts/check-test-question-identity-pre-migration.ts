import { execFileSync } from 'node:child_process'

import { createClient } from '@supabase/supabase-js'
import { parse } from 'dotenv'

import {
  activateTestFromDraftAtomic,
  saveTestDraftAtomic,
} from '@/lib/server/assessment-drafts'
import type { Database } from '@/types/database'
import type { TestDraftContent } from '@/types'

const TEACHER_ID = 'b1349000-0000-4000-8000-000000000001'
const STUDENT_ID = 'b1349000-0000-4000-8000-000000000002'
const TEST_ID = 'b1349000-0000-4000-8000-000000000011'
const FIRST_ROW_ID = 'b1349000-0000-4000-8000-000000000020'
const FIRST_PORTABLE_ID = 'b1349000-0000-4000-8000-000000000021'
const SECOND_ROW_ID = FIRST_PORTABLE_ID
const SECOND_PORTABLE_ID = 'b1349000-0000-4000-8000-000000000031'
const THIRD_PORTABLE_ID = 'b1349000-0000-4000-8000-000000000041'
const TRANSIENT_PORTABLE_ID = 'b1349000-0000-4000-8000-000000000051'

function localSupabase() {
  const status = parse(execFileSync(
    'supabase',
    ['status', '-o', 'env'],
    { cwd: process.cwd(), encoding: 'utf8' },
  ))
  const apiUrl = status.API_URL
  const serviceRoleKey = status.SERVICE_ROLE_KEY
  if (!apiUrl || !serviceRoleKey) {
    throw new Error('Local Supabase API URL or service-role key is unavailable')
  }
  const url = new URL(apiUrl)
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
  ) {
    throw new Error('Pre-migration identity contract refuses non-loopback Supabase targets')
  }
  return createClient<Database>(url.origin, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function question(id: string, text: string) {
  return {
    id,
    question_type: 'open_response' as const,
    question_text: text,
    options: [],
    correct_option: null,
    answer_key: null,
    sample_solution: null,
    points: 1,
    response_max_chars: 5000,
    response_monospace: false,
  }
}

async function main() {
  const supabase = localSupabase()
  const collisionContent: TestDraftContent = {
    title: 'Rejected identity collision',
    show_results: false,
    question_identity_version: 1,
    questions: [question(FIRST_ROW_ID, 'Draft-only identity colliding with an internal row ID')],
  }
  const collision = await saveTestDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 7,
    content: collisionContent,
  })
  if (collision.ok || collision.status !== 409) {
    throw new Error('Pre-migration save accepted a draft-only/internal-row identity collision')
  }

  const firstPortableContent: TestDraftContent = {
    title: 'Legacy row-ID precedence',
    show_results: false,
    question_identity_version: 1,
    questions: [
      question(SECOND_PORTABLE_ID, 'Moved collision question'),
      question(FIRST_PORTABLE_ID, 'Edited original question'),
      question(THIRD_PORTABLE_ID, 'Draft-only addition'),
      question(TRANSIENT_PORTABLE_ID, 'Temporary draft-only addition'),
    ],
  }

  const closedSave = await saveTestDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 7,
    content: firstPortableContent,
  })
  if (closedSave.ok || closedSave.status !== 409) {
    throw new Error('Pre-migration closed Test accepted a question-graph change')
  }

  const { error: reopenForEditError } = await supabase
    .from('tests')
    .update({ status: 'draft' })
    .eq('id', TEST_ID)
  if (reopenForEditError) throw reopenForEditError

  const firstSave = await saveTestDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 7,
    content: firstPortableContent,
  })
  if (!firstSave.ok) {
    throw new Error(`Pre-migration portable save failed: ${firstSave.status} ${firstSave.error}`)
  }
  if (
    firstSave.draft.version !== 8
    || firstSave.draft.content.question_identity_version !== 1
    || firstSave.draft.content.questions[0]?.id !== SECOND_PORTABLE_ID
    || firstSave.draft.content.questions[1]?.id !== FIRST_PORTABLE_ID
    || firstSave.draft.content.questions[2]?.id !== THIRD_PORTABLE_ID
    || firstSave.draft.content.questions[3]?.id !== TRANSIENT_PORTABLE_ID
  ) {
    throw new Error('Pre-migration save did not return the portable API contract')
  }

  const { data: firstRows, error: firstRowsError } = await supabase
    .from('test_questions')
    .select('id, artifact_id, question_text, position')
    .eq('test_id', TEST_ID)
    .order('position')
  if (firstRowsError) throw firstRowsError
  if (
    firstRows?.length !== 2
    || firstRows[0]?.id !== FIRST_ROW_ID
    || firstRows[1]?.id !== SECOND_ROW_ID
  ) {
    throw new Error('Pre-migration draft save changed materialized question rows before activation')
  }

  const { error: attemptError } = await supabase.from('test_attempts').insert({
    test_id: TEST_ID,
    student_id: STUDENT_ID,
    responses: {},
  })
  if (attemptError) throw attemptError
  const blockedActivation = await activateTestFromDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 8,
  })
  if (blockedActivation.ok || blockedActivation.status !== 409) {
    throw new Error('Pre-migration activation changed questions after student work existed')
  }
  const { data: restoredDraftTest, error: restoredDraftTestError } = await supabase
    .from('tests')
    .select('status')
    .eq('id', TEST_ID)
    .single()
  if (restoredDraftTestError || restoredDraftTest?.status !== 'draft') {
    throw restoredDraftTestError ?? new Error('Rejected activation did not restore draft status')
  }
  const { error: removeAttemptError } = await supabase
    .from('test_attempts')
    .delete()
    .eq('test_id', TEST_ID)
  if (removeAttemptError) throw removeAttemptError

  const portableContent: TestDraftContent = {
    ...firstPortableContent,
    questions: [
      question(THIRD_PORTABLE_ID, 'Draft-only addition retained'),
      question(FIRST_PORTABLE_ID, 'Edited original question retained'),
      question(SECOND_PORTABLE_ID, 'Moved collision question retained'),
    ],
  }
  const saved = await saveTestDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 8,
    content: portableContent,
  })
  if (!saved.ok || saved.draft.version !== 9) {
    throw new Error(`Pre-migration removal save failed: ${saved.ok ? 'wrong version' : `${saved.status} ${saved.error}`}`)
  }

  const { data: storedDraft, error: storedDraftError } = await supabase
    .from('assessment_drafts')
    .select('content, version')
    .eq('assessment_type', 'test')
    .eq('assessment_id', TEST_ID)
    .single()
  if (storedDraftError || !storedDraft) throw storedDraftError
  const storedContent = storedDraft.content as unknown as TestDraftContent
  if (
    storedDraft.version !== 9
    || storedContent.question_identity_version !== undefined
    || storedContent.questions[0]?.id !== THIRD_PORTABLE_ID
    || storedContent.questions[1]?.id !== FIRST_ROW_ID
    || storedContent.questions[2]?.id !== SECOND_ROW_ID
  ) {
    throw new Error('Pre-migration save did not preserve the legacy stored identity contract')
  }

  const activated = await activateTestFromDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 9,
  })
  if (!activated.ok) {
    throw new Error(`Pre-migration activation failed: ${activated.status} ${activated.error}`)
  }

  const { data: activatedTest, error: activatedTestError } = await supabase
    .from('tests')
    .select('status')
    .eq('id', TEST_ID)
    .single()
  if (activatedTestError || activatedTest?.status !== 'active') {
    throw activatedTestError ?? new Error('Pre-migration activation did not activate the Test')
  }

  const { data: rows, error: rowsError } = await supabase
    .from('test_questions')
    .select('id, artifact_id')
    .eq('test_id', TEST_ID)
    .order('position')
  if (rowsError) throw rowsError
  if (
    rows?.length !== 3
    || rows[0]?.id !== THIRD_PORTABLE_ID
    || rows[0]?.artifact_id !== THIRD_PORTABLE_ID
    || rows[1]?.id !== FIRST_ROW_ID
    || rows[1]?.artifact_id !== FIRST_PORTABLE_ID
    || rows[2]?.id !== SECOND_ROW_ID
    || rows[2]?.artifact_id !== SECOND_PORTABLE_ID
  ) {
    throw new Error('Pre-migration activation confused portable identity with row identity')
  }

  const concurrentEdit: TestDraftContent = {
    ...portableContent,
    questions: [
      question(THIRD_PORTABLE_ID, 'Unsafe concurrent edit'),
      ...portableContent.questions.slice(1),
    ],
  }
  const [concurrentSave, concurrentAttempt] = await Promise.all([
    saveTestDraftAtomic(supabase, {
      teacherId: TEACHER_ID,
      testId: TEST_ID,
      expectedDraftVersion: 9,
      content: concurrentEdit,
    }),
    supabase.rpc('save_test_attempt_atomic', {
      p_test_id: TEST_ID,
      p_student_id: STUDENT_ID,
      p_responses: {},
    }),
  ])
  if (concurrentSave.ok || concurrentSave.status !== 409) {
    throw new Error('Concurrent pre-migration active save changed the question graph')
  }
  if (concurrentAttempt.error) throw concurrentAttempt.error

  const { data: postRaceRows, error: postRaceRowsError } = await supabase
    .from('test_questions')
    .select('id, question_text')
    .eq('test_id', TEST_ID)
    .order('position')
  if (postRaceRowsError) throw postRaceRowsError
  if (
    postRaceRows?.length !== 3
    || postRaceRows[0]?.id !== THIRD_PORTABLE_ID
    || postRaceRows[0]?.question_text !== 'Draft-only addition retained'
  ) {
    throw new Error('Concurrent student attempt observed a partial teacher question edit')
  }
  const { error: removeConcurrentAttemptError } = await supabase
    .from('test_attempts')
    .delete()
    .eq('test_id', TEST_ID)
  if (removeConcurrentAttemptError) throw removeConcurrentAttemptError

  const { error: restoreStatusError } = await supabase
    .from('tests')
    .update({ status: 'closed' })
    .eq('id', TEST_ID)
  if (restoreStatusError) throw restoreStatusError

  process.stdout.write('Pre-migration Test identity compatibility contract passed.\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
