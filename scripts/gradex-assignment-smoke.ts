import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), process.env.ENV_FILE || '.env.local') })

type SupabaseClient = ReturnType<typeof createClient>

const SMOKE_CLASS_CODE = 'GRADEXSMOKE'
const TEACHER_EMAIL = 'gradex-smoke-teacher@example.com'
const STUDENT_EMAIL = 'gradex-smoke-student@example.com'
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed'])

async function main() {
  requireEnv('GRADEX_ASSIGNMENT_GRADING_ENABLED')
  requireEnv('GRADEX_API_URL')
  requireEnv('GRADEX_API_KEY')
  requireEnv('GRADEX_PIKA_PSEUDONYM_SALT')

  if (process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED?.trim().toLowerCase() !== 'true') {
    throw new Error('GRADEX_ASSIGNMENT_GRADING_ENABLED must be true for this smoke.')
  }

  const supabase = createServiceClient()
  const {
    createOrResumeAssignmentAiGradingRun,
    getAssignmentAiGradingRunSummary,
    tickAssignmentAiGradingRun,
  } = await import('../src/lib/server/assignment-ai-grading-runs')

  const seed = await seedGradexAssignmentSmoke(supabase)
  console.log(JSON.stringify({
    event: 'seeded',
    classroom_id: seed.classroomId,
    assignment_id: seed.assignmentId,
    student_id: seed.studentId,
    assignment_doc_id: seed.assignmentDocId,
  }, null, 2))

  const created = await createOrResumeAssignmentAiGradingRun({
    assignmentId: seed.assignmentId,
    teacherId: seed.teacherId,
    studentIds: [seed.studentId],
  })

  console.log(JSON.stringify({
    event: 'run_created',
    kind: created.kind,
    run: created.run,
  }, null, 2))

  const pollAttempts = parsePositiveInt(process.env.GRADEX_ASSIGNMENT_SMOKE_POLL_ATTEMPTS, 30)
  const pollIntervalMs = parsePositiveInt(process.env.GRADEX_ASSIGNMENT_SMOKE_POLL_INTERVAL_MS, 1500)

  let summary = created.run
  for (let attempt = 1; attempt <= pollAttempts && !TERMINAL_STATUSES.has(summary.status); attempt += 1) {
    const tick = await tickAssignmentAiGradingRun({
      assignmentId: seed.assignmentId,
      runId: summary.id,
    })

    await maybeTickGradexRun(supabase, summary.id)

    summary =
      await getAssignmentAiGradingRunSummary({
        assignmentId: seed.assignmentId,
        runId: summary.id,
      }) ?? tick.run

    console.log(JSON.stringify({
      event: 'poll',
      attempt,
      claimed: tick.claimed,
      run: summary,
      gradex: await loadGradexRunMetadata(supabase, summary.id),
    }, null, 2))

    if (TERMINAL_STATUSES.has(summary.status)) break
    await sleep(pollIntervalMs)
  }

  const finalRun = await loadGradexRunMetadata(supabase, summary.id)
  const finalDoc = await loadAssignmentDocGrade(supabase, seed.assignmentDocId)

  console.log(JSON.stringify({
    event: 'final',
    run: summary,
    gradex: finalRun,
    grade: finalDoc,
  }, null, 2))

  if (!TERMINAL_STATUSES.has(summary.status)) {
    throw new Error(`Pika Gradex assignment smoke did not finish after ${pollAttempts} attempts.`)
  }
  if (summary.status !== 'completed') {
    throw new Error(`Pika Gradex assignment smoke finished with ${summary.status}.`)
  }
  if (!finalRun.gradex_run_id || finalRun.gradex_status !== 'completed') {
    throw new Error('Pika run did not record a completed Gradex run.')
  }
  if (!isValidGrade(finalDoc)) {
    throw new Error('Assignment doc did not receive complete Gradex scores and feedback.')
  }
}

async function seedGradexAssignmentSmoke(supabase: SupabaseClient) {
  const now = new Date()
  const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const submittedAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  const startDate = now.toISOString().slice(0, 10)
  const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  await ensureOk(
    supabase.from('classrooms').delete().eq('class_code', SMOKE_CLASS_CODE),
    'Delete old smoke classroom',
  )

  const teacher = await upsertUser(supabase, TEACHER_EMAIL, 'teacher')
  const student = await upsertUser(supabase, STUDENT_EMAIL, 'student')

  await ensureOk(
    supabase.from('student_profiles').upsert({
      user_id: student.id,
      student_number: 'gradex-smoke-001',
      first_name: 'Gradex',
      last_name: 'Learner',
    }, { onConflict: 'user_id' }),
    'Upsert smoke student profile',
  )

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: teacher.id,
      title: 'Gradex Assignment Smoke',
      class_code: SMOKE_CLASS_CODE,
      term_label: 'Gradex smoke',
      start_date: startDate,
      end_date: endDate,
      allow_enrollment: true,
    })
    .select('id')
    .single()
  if (classroomError || !classroom) {
    throw new Error(`Create smoke classroom failed: ${formatSupabaseError(classroomError)}`)
  }

  await ensureOk(
    supabase.from('classroom_roster').upsert({
      classroom_id: classroom.id,
      email: STUDENT_EMAIL,
      student_number: 'gradex-smoke-001',
      first_name: 'Gradex',
      last_name: 'Learner',
    }, { onConflict: 'classroom_id,email' }),
    'Upsert smoke roster row',
  )

  await ensureOk(
    supabase.from('classroom_enrollments').upsert({
      classroom_id: classroom.id,
      student_id: student.id,
    }, { onConflict: 'classroom_id,student_id' }),
    'Upsert smoke enrollment',
  )

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .insert({
      classroom_id: classroom.id,
      title: 'Gradex Smoke Portfolio Reflection',
      description: 'Write a short reflection about the portfolio changes and process evidence.',
      instructions_markdown:
        'Write a concise portfolio reflection. Explain what changed, why it improved the work, and what evidence shows the process was thoughtful.',
      rich_instructions: null,
      due_at: dueAt,
      position: 0,
      is_draft: false,
      released_at: now.toISOString(),
      track_authenticity: true,
      points_possible: 30,
      include_in_final: true,
      gradebook_weight: 1,
      created_by: teacher.id,
    })
    .select('id')
    .single()
  if (assignmentError || !assignment) {
    throw new Error(`Create smoke assignment failed: ${formatSupabaseError(assignmentError)}`)
  }

  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text:
              'I revised my portfolio by making the project goals clearer, simplifying the navigation, and adding reflection notes for each major decision.',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text:
              'The strongest improvement is that the homepage now explains the audience and purpose before showing screenshots. My process evidence shows steady revision instead of one last-minute change.',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text:
              'Next time I would add a short accessibility checklist before the final draft so the design choices are easier to defend.',
          },
        ],
      },
    ],
  }

  const { data: doc, error: docError } = await supabase
    .from('assignment_docs')
    .upsert({
      assignment_id: assignment.id,
      student_id: student.id,
      content,
      is_submitted: true,
      submitted_at: submittedAt,
      authenticity_score: 82,
      authenticity_flags: [],
    }, { onConflict: 'assignment_id,student_id' })
    .select('id')
    .single()
  if (docError || !doc) {
    throw new Error(`Create smoke assignment doc failed: ${formatSupabaseError(docError)}`)
  }

  return {
    teacherId: teacher.id,
    studentId: student.id,
    classroomId: classroom.id as string,
    assignmentId: assignment.id as string,
    assignmentDocId: doc.id as string,
  }
}

async function upsertUser(supabase: SupabaseClient, email: string, role: 'teacher' | 'student') {
  const { data, error } = await supabase
    .from('users')
    .upsert({ email, role }, { onConflict: 'email' })
    .select('id, email')
    .single()
  if (error || !data) {
    throw new Error(`Upsert ${role} user failed: ${formatSupabaseError(error)}`)
  }
  return data as { id: string; email: string }
}

async function maybeTickGradexRun(supabase: SupabaseClient, pikaRunId: string) {
  const internalToken = process.env.GRADEX_INTERNAL_TOKEN?.trim() || process.env.GRADEX_INTERNAL_SECRET?.trim()
  if (!internalToken) return

  const metadata = await loadGradexRunMetadata(supabase, pikaRunId)
  if (!metadata.gradex_run_id || metadata.gradex_status === 'completed') return

  const baseUrl = requireEnv('GRADEX_API_URL').replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/api/internal/grading-runs/tick`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${internalToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ runId: metadata.gradex_run_id, limit: 4 }),
  })
  if (!response.ok) {
    throw new Error(`Gradex internal tick failed with ${response.status}: ${await response.text()}`)
  }
}

async function loadGradexRunMetadata(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from('assignment_ai_grading_runs')
    .select('id, status, gradex_run_id, gradex_status, gradex_submitted_at, gradex_last_polled_at')
    .eq('id', runId)
    .single()
  if (error || !data) {
    throw new Error(`Load Gradex run metadata failed: ${formatSupabaseError(error)}`)
  }
  return data as {
    id: string
    status: string
    gradex_run_id: string | null
    gradex_status: string | null
    gradex_submitted_at: string | null
    gradex_last_polled_at: string | null
  }
}

async function loadAssignmentDocGrade(supabase: SupabaseClient, assignmentDocId: string) {
  const { data, error } = await supabase
    .from('assignment_docs')
    .select('id, score_completion, score_thinking, score_workflow, teacher_feedback_draft, ai_feedback_model, graded_at, graded_by')
    .eq('id', assignmentDocId)
    .single()
  if (error || !data) {
    throw new Error(`Load smoke assignment doc failed: ${formatSupabaseError(error)}`)
  }
  return data as {
    id: string
    score_completion: number | null
    score_thinking: number | null
    score_workflow: number | null
    teacher_feedback_draft: string | null
    ai_feedback_model: string | null
    graded_at: string | null
    graded_by: string | null
  }
}

function isValidGrade(doc: Awaited<ReturnType<typeof loadAssignmentDocGrade>>) {
  return (
    Number.isInteger(doc.score_completion) &&
    Number.isInteger(doc.score_thinking) &&
    Number.isInteger(doc.score_workflow) &&
    Boolean(doc.teacher_feedback_draft?.trim()) &&
    Boolean(doc.ai_feedback_model?.startsWith('gradex:')) &&
    Boolean(doc.graded_at)
  )
}

function createServiceClient() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseSecretKey = requireEnv('SUPABASE_SECRET_KEY')
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function ensureOk(promise: Promise<{ error: unknown }>, label: string) {
  const result = await promise
  if (result.error) {
    throw new Error(`${label} failed: ${formatSupabaseError(result.error)}`)
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function formatSupabaseError(error: unknown): string {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
