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
const TEST_ID = 'b1349000-0000-4000-8000-000000000011'
const FIRST_ROW_ID = 'b1349000-0000-4000-8000-000000000020'
const FIRST_PORTABLE_ID = 'b1349000-0000-4000-8000-000000000021'
const SECOND_ROW_ID = FIRST_PORTABLE_ID
const SECOND_PORTABLE_ID = 'b1349000-0000-4000-8000-000000000031'

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
  const portableContent: TestDraftContent = {
    title: 'Legacy row-ID precedence',
    show_results: false,
    question_identity_version: 1,
    questions: [
      question(FIRST_PORTABLE_ID, 'Question zero carrying the later row ID'),
      question(SECOND_PORTABLE_ID, 'Later question whose row ID was reused'),
    ],
  }

  const saved = await saveTestDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 7,
    content: portableContent,
  })
  if (!saved.ok) {
    throw new Error(`Pre-migration portable save failed: ${saved.status} ${saved.error}`)
  }
  if (
    saved.draft.version !== 8
    || saved.draft.content.question_identity_version !== 1
    || saved.draft.content.questions[0]?.id !== FIRST_PORTABLE_ID
    || saved.draft.content.questions[1]?.id !== SECOND_PORTABLE_ID
  ) {
    throw new Error('Pre-migration save did not return the portable API contract')
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
    storedDraft.version !== 8
    || storedContent.question_identity_version !== undefined
    || storedContent.questions[0]?.id !== FIRST_ROW_ID
    || storedContent.questions[1]?.id !== SECOND_ROW_ID
  ) {
    throw new Error('Pre-migration save did not preserve the legacy stored identity contract')
  }

  const { error: reopenError } = await supabase
    .from('tests')
    .update({ status: 'draft' })
    .eq('id', TEST_ID)
  if (reopenError) throw reopenError

  const activated = await activateTestFromDraftAtomic(supabase, {
    teacherId: TEACHER_ID,
    testId: TEST_ID,
    expectedDraftVersion: 8,
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
    rows?.length !== 2
    || rows[0]?.id !== FIRST_ROW_ID
    || rows[0]?.artifact_id !== FIRST_PORTABLE_ID
    || rows[1]?.id !== SECOND_ROW_ID
    || rows[1]?.artifact_id !== SECOND_PORTABLE_ID
  ) {
    throw new Error('Pre-migration activation confused portable identity with row identity')
  }

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
