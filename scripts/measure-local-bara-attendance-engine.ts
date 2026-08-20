import { randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import { executeTeacherAttendanceSessionCommand } from '../src/lib/server/bara-attendance-commands'
import { nearestRankPercentile } from '../src/lib/server/bara-attendance-load'
import { loadTeacherAttendanceQrPresentation } from '../src/lib/server/bara-attendance-qr'
import { executeStudentAttendanceCheckIn } from '../src/lib/server/bara-attendance-student'
import { syncTeacherAttendanceSources } from '../src/lib/server/bara-attendance-sync'

const MIN_CONCURRENCY = 30
const MAX_CONCURRENCY = 100

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertLoopback(name: string, value: string) {
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`${name} must target loopback`)
  }
  return url.origin
}

function readConcurrency() {
  const index = process.argv.indexOf('--concurrency')
  const value = Number(index === -1 ? undefined : process.argv[index + 1])
  if (!Number.isInteger(value) || value < MIN_CONCURRENCY || value > MAX_CONCURRENCY) {
    throw new Error(`--concurrency must be an integer from ${MIN_CONCURRENCY} to ${MAX_CONCURRENCY}`)
  }
  return value
}

function todayInToronto() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts()
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function rounded(value: number) {
  return Math.round(value * 10) / 10
}

async function main() {
  if (process.env.LOCAL_ATTENDANCE_LOAD !== 'shared-local-disposable') {
    throw new Error('Set LOCAL_ATTENDANCE_LOAD=shared-local-disposable to acknowledge the local-only write guard')
  }

  const concurrency = readConcurrency()
  const supabaseUrl = assertLoopback('NEXT_PUBLIC_SUPABASE_URL', required('NEXT_PUBLIC_SUPABASE_URL'))
  assertLoopback('BARA_ATTENDANCE_API_BASE_URL', required('BARA_ATTENDANCE_API_BASE_URL'))
  const supabase = createClient(supabaseUrl, required('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const teacherSubject = `user_local_load_teacher_${suffix}`
  const studentSubjects = Array.from(
    { length: concurrency },
    (_, index) => `user_local_load_student_${index + 1}_${suffix}`,
  )
  const classDate = todayInToronto()

  const { data: users, error: usersError } = await supabase
    .from('users')
    .insert([
      { email: `load-teacher-${suffix}@local.invalid`, role: 'teacher', workos_user_id: teacherSubject },
      ...studentSubjects.map((subject, index) => ({
        email: `load-student-${index + 1}-${suffix}@local.invalid`,
        role: 'student',
        workos_user_id: subject,
      })),
    ])
    .select('id, email, role')
  if (usersError || !users || users.length !== concurrency + 1) {
    throw usersError ?? new Error('User seed failed')
  }
  const teacher = users.find((user) => user.role === 'teacher')!
  const students = users.filter((user) => user.role === 'student')

  const { error: profilesError } = await supabase.from('student_profiles').insert(
    students.map((student, index) => ({
      user_id: student.id,
      student_number: `LOAD-${suffix}-${index + 1}`,
      first_name: `Load${index + 1}`,
      last_name: 'Student',
    })),
  )
  if (profilesError) throw profilesError

  const { data: classroom, error: classroomError } = await supabase.from('classrooms').insert({
    teacher_id: teacher.id,
    title: `Local attendance load ${suffix}`,
    class_code: `P${suffix.slice(0, 5).toUpperCase()}`,
    start_date: classDate,
    end_date: classDate,
  }).select('id').single()
  if (classroomError || !classroom) throw classroomError ?? new Error('Classroom seed failed')

  const { error: enrollmentError } = await supabase.from('classroom_enrollments').insert(
    students.map((student) => ({ classroom_id: classroom.id, student_id: student.id })),
  )
  if (enrollmentError) throw enrollmentError
  const { error: classDayError } = await supabase.from('class_days').insert({
    classroom_id: classroom.id,
    date: classDate,
    is_class_day: true,
  })
  if (classDayError) throw classDayError
  const { error: policyError } = await supabase.rpc('upsert_attendance_window_policy_v1', {
    p_teacher_id: teacher.id,
    p_classroom_id: classroom.id,
    p_opens_local: '00:01',
    p_closes_local: '23:59',
    p_close_day_offset: 0,
    p_enabled: true,
    p_expected_revision: null,
  })
  if (policyError) throw policyError

  const actor = { workosSubject: teacherSubject, displayName: 'Local Load Teacher' }
  const synced = await syncTeacherAttendanceSources({
    supabase,
    teacherId: teacher.id,
    classroomId: classroom.id,
    windowStart: classDate,
    windowEnd: classDate,
    actor,
    integrationState: 'ready',
  })
  assert(synced.roster.outcome === 'applied', 'Roster snapshot was not applied')
  assert(synced.schedule.outcome === 'applied', 'Schedule snapshot was not applied')

  const opened = await executeTeacherAttendanceSessionCommand({
    supabase,
    teacherId: teacher.id,
    classroomId: classroom.id,
    classDate,
    requestId: randomUUID(),
    command: 'open',
    actor,
    integrationState: 'ready',
  })
  assert(opened.state === 'open', 'Session did not open')

  try {
    const qr = await loadTeacherAttendanceQrPresentation({
      supabase,
      teacherId: teacher.id,
      classroomId: classroom.id,
      classDate,
      requestId: randomUUID(),
      actor,
      integrationState: 'ready',
    })
    const entryToken = qr.entryPath.split('/').at(-1)!
    const startedAt = performance.now()
    const outcomes = await Promise.all(students.map(async (student, index) => {
      const requestStartedAt = performance.now()
      const view = await executeStudentAttendanceCheckIn({
        supabase,
        pikaUser: { id: student.id, email: student.email, role: 'student' },
        entryToken,
        integrationState: 'ready',
        resolveActor: async () => ({
          workosSubject: studentSubjects[index]!,
          displayName: `Load${index + 1} Student`,
        }),
      })
      return { state: view.state, latencyMs: performance.now() - requestStartedAt }
    }))
    const durationMs = performance.now() - startedAt
    const latency = outcomes.map((outcome) => outcome.latencyMs)
    const stateCounts = Object.fromEntries(
      [...new Set(outcomes.map((outcome) => outcome.state))].map((state) => [
        state,
        outcomes.filter((outcome) => outcome.state === state).length,
      ]),
    )
    const confirmed = outcomes.filter(({ state }) => state === 'checked_in' || state === 'already_checked_in').length
    assert(confirmed === concurrency, 'Not every local scan returned an authoritative confirmation')

    process.stdout.write(`${JSON.stringify({
      target: 'local_bara_signed_adapter_engine',
      attempted: concurrency,
      confirmed,
      stateCounts,
      concurrency,
      durationMs: rounded(durationMs),
      requestsPerSecond: rounded(concurrency / (durationMs / 1_000)),
      latencyMs: {
        min: rounded(Math.min(...latency)),
        p50: rounded(nearestRankPercentile(latency, 50)),
        p95: rounded(nearestRankPercentile(latency, 95)),
        p99: rounded(nearestRankPercentile(latency, 99)),
        max: rounded(Math.max(...latency)),
      },
    }, null, 2)}\n`)
  } finally {
    await executeTeacherAttendanceSessionCommand({
      supabase,
      teacherId: teacher.id,
      classroomId: classroom.id,
      classDate,
      requestId: randomUUID(),
      command: 'close',
      actor,
      integrationState: 'ready',
    })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Local attendance load measurement failed: ${error instanceof Error ? error.message : 'unknown'}.\n`)
  process.exitCode = 1
})
