import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import { executeTeacherAttendanceMarks, executeTeacherAttendanceSessionCommand } from '../src/lib/server/bara-attendance-commands'
import { postBaraStudentCheckIn, type BaraStudentCheckInResult } from '../src/lib/server/bara-attendance-client'
import { receiveBaraAttendanceEvent } from '../src/lib/server/bara-attendance-events'
import { loadTeacherAttendanceQrPresentation } from '../src/lib/server/bara-attendance-qr'
import { executeStudentAttendanceCheckIn } from '../src/lib/server/bara-attendance-student'
import { syncTeacherAttendanceSources } from '../src/lib/server/bara-attendance-sync'
import { createV1RequestSignature } from '../src/vendor/attendance-contract/v1/signing'
import type { V1Event, V1StudentCheckIn } from '../src/vendor/attendance-contract/v1/types'

const EVENT_PATH = '/api/integrations/attendance/v1/events'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function assertLocalUrl(name: string, value: string) {
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`${name} must target an isolated loopback service`)
  }
  return url.origin
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function tomorrowInToronto() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(Date.now() + 36 * 60 * 60 * 1_000)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function waitFor<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function main() {
  if (process.env.LOCAL_ATTENDANCE_REHEARSAL !== 'isolated-only') {
    throw new Error('Set LOCAL_ATTENDANCE_REHEARSAL=isolated-only to acknowledge the local-only guard')
  }

  const supabaseUrl = assertLocalUrl('NEXT_PUBLIC_SUPABASE_URL', required('NEXT_PUBLIC_SUPABASE_URL'))
  assertLocalUrl('BARA_ATTENDANCE_API_BASE_URL', required('BARA_ATTENDANCE_API_BASE_URL'))
  const serviceKey = required('SUPABASE_SECRET_KEY')
  const eventSecret = required('BARA_ATTENDANCE_EVENT_SECRET')
  const installationRef = required('BARA_ATTENDANCE_INSTALLATION_REF')
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const capturedEvents: V1Event[] = []
  const eventServer = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString('utf8')
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
        else if (value !== undefined) headers.set(name, value)
      }
      const result = await receiveBaraAttendanceEvent(new Request(
        `http://127.0.0.1:3100${request.url ?? EVENT_PATH}`,
        { method: request.method, headers, body },
      ))
      if (result.ok) capturedEvents.push(JSON.parse(body) as V1Event)
      response.statusCode = result.status
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(result.ok ? result.value : { error: result.error }))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown' }))
    }
  })

  await new Promise<void>((resolve, reject) => {
    eventServer.once('error', reject)
    eventServer.listen(3100, '127.0.0.1', resolve)
  })

  try {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const teacherSubject = `user_local_teacher_${suffix}`
    const studentSubjects = [
      `user_local_student_one_${suffix}`,
      `user_local_student_two_${suffix}`,
    ]
    const classDate = tomorrowInToronto()

    const { data: users, error: usersError } = await supabase
      .from('users')
      .insert([
        { email: `teacher-${suffix}@local.invalid`, role: 'teacher', workos_user_id: teacherSubject },
        { email: `student-one-${suffix}@local.invalid`, role: 'student', workos_user_id: studentSubjects[0] },
        { email: `student-two-${suffix}@local.invalid`, role: 'student', workos_user_id: studentSubjects[1] },
      ])
      .select('id, email, role, workos_user_id')
    if (usersError || !users || users.length !== 3) throw usersError ?? new Error('User seed failed')
    const teacher = users.find((user) => user.role === 'teacher')!
    const students = users.filter((user) => user.role === 'student')

    const { error: profilesError } = await supabase.from('student_profiles').insert(students.map((student, index) => ({
      user_id: student.id,
      student_number: `LOCAL-${suffix}-${index + 1}`,
      first_name: `Local${index + 1}`,
      last_name: 'Student',
    })))
    if (profilesError) throw profilesError

    const { data: classroom, error: classroomError } = await supabase.from('classrooms').insert({
      teacher_id: teacher.id,
      title: `Local attendance ${suffix}`,
      class_code: `L${suffix.slice(0, 5).toUpperCase()}`,
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

    const actor = { workosSubject: teacherSubject, displayName: 'Local Teacher' }
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

    const { data: mapping, error: mappingError } = await supabase
      .from('attendance_occurrence_mappings')
      .select('occurrence_ref')
      .eq('classroom_id', classroom.id)
      .eq('class_date', classDate)
      .single()
    if (mappingError || !mapping) throw mappingError ?? new Error('Occurrence mapping missing')

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

    const rawCheckIns: Array<{ payload: V1StudentCheckIn; result: BaraStudentCheckInResult }> = []
    const sendCheckIn = async (payload: V1StudentCheckIn) => {
      const result = await postBaraStudentCheckIn(payload)
      rawCheckIns.push({ payload, result })
      return result
    }
    const studentOne = {
      id: students[0]!.id,
      email: students[0]!.email,
      role: 'student',
    }
    const resolveStudentOne = async () => ({
      workosSubject: studentSubjects[0]!,
      displayName: 'Local1 Student',
    })
    const firstCheckIn = await executeStudentAttendanceCheckIn({
      supabase,
      pikaUser: studentOne,
      entryToken,
      integrationState: 'ready',
      resolveActor: resolveStudentOne,
      send: sendCheckIn,
    })
    const retryCheckIn = await executeStudentAttendanceCheckIn({
      supabase,
      pikaUser: studentOne,
      entryToken,
      integrationState: 'ready',
      resolveActor: resolveStudentOne,
      send: sendCheckIn,
    })
    assert(firstCheckIn.state === 'checked_in', 'Student check-in was not applied')
    assert(rawCheckIns[0]?.result.outcome === 'applied', 'First student check-in was not authoritative')
    assert(rawCheckIns[1]?.result.outcome === 'duplicate', 'Retry was not returned as an idempotent duplicate')
    assert(rawCheckIns[0]?.payload.idempotency_key === rawCheckIns[1]?.payload.idempotency_key, 'Retry changed its idempotency key')
    assert(retryCheckIn.state === 'checked_in', 'Duplicate response did not preserve the authoritative UI result')

    const corrected = await executeTeacherAttendanceMarks({
      supabase,
      teacherId: teacher.id,
      classroomId: classroom.id,
      classDate,
      requestId: randomUUID(),
      actor,
      marks: [{ studentId: students[0]!.id, status: 'late', reasonCode: 'local_correction' }],
      integrationState: 'ready',
    })
    assert(corrected.appliedCount === 1, 'Teacher correction was not applied')

    const closed = await executeTeacherAttendanceSessionCommand({
      supabase,
      teacherId: teacher.id,
      classroomId: classroom.id,
      classDate,
      requestId: randomUUID(),
      command: 'close',
      actor,
      integrationState: 'ready',
    })
    assert(closed.state === 'closed', 'Session did not close')

    const closedStudent = await executeStudentAttendanceCheckIn({
      supabase,
      pikaUser: { id: students[1]!.id, email: students[1]!.email, role: 'student' },
      entryToken,
      integrationState: 'ready',
      resolveActor: async () => ({ workosSubject: studentSubjects[1]!, displayName: 'Local2 Student' }),
    })
    assert(closedStudent.state === 'closed', 'Closed-session scan did not return the authoritative closed state')

    const closedProjection = await waitFor(async () => {
      const { data, error } = await supabase.from('attendance_session_projection')
        .select('status, session_revision')
        .eq('installation_ref', installationRef)
        .eq('occurrence_ref', mapping.occurrence_ref)
        .maybeSingle()
      if (error) throw error
      return data?.status === 'closed' ? data : null
    }, 'closed Pika projection')
    const correctedProjection = await waitFor(async () => {
      const { data, error } = await supabase.from('attendance_record_projection')
        .select('status, record_revision')
        .eq('installation_ref', installationRef)
        .eq('occurrence_ref', mapping.occurrence_ref)
        .eq('status', 'late')
        .maybeSingle()
      if (error) throw error
      return data ?? null
    }, 'corrected Pika record projection')

    const scheduledEvent = capturedEvents.find((event) => event.event_type === 'attendance.session.scheduled')
    const closedEvent = [...capturedEvents].reverse().find((event) => event.event_type === 'attendance.session.closed')
    assert(scheduledEvent && closedEvent, 'Expected scheduled and closed events were not delivered')

    async function signedIngress(event: V1Event) {
      const timestamp = Math.floor(Date.now() / 1_000).toString()
      const nonce = `local_replay_${randomUUID().replaceAll('-', '')}`
      const body = JSON.stringify(event)
      const signature = await createV1RequestSignature({
        secret: eventSecret,
        method: 'POST',
        path: EVENT_PATH,
        timestamp,
        nonce,
        body,
      })
      return receiveBaraAttendanceEvent(new Request(`http://127.0.0.1:3100${EVENT_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-attendance-installation-ref': installationRef,
          'x-attendance-timestamp': timestamp,
          'x-attendance-nonce': nonce,
          'x-attendance-signature': signature,
        },
        body,
      }))
    }

    const duplicateEvent = await signedIngress(closedEvent)
    assert(duplicateEvent.ok && duplicateEvent.value.duplicate && !duplicateEvent.value.projection_applied, 'Duplicate event was not accepted idempotently')

    const staleEvent = {
      ...scheduledEvent,
      event_id: `${scheduledEvent.event_id}_late_delivery`,
      idempotency_key: `${scheduledEvent.idempotency_key}:late-delivery`,
      correlation_ref: `${scheduledEvent.correlation_ref}_late_delivery`,
    } as V1Event
    const reorderedEvent = await signedIngress(staleEvent)
    assert(reorderedEvent.ok && !reorderedEvent.value.duplicate && !reorderedEvent.value.projection_applied, 'Reordered stale event changed the projection')

    const { data: finalProjection, error: finalProjectionError } = await supabase
      .from('attendance_session_projection')
      .select('status, session_revision')
      .eq('installation_ref', installationRef)
      .eq('occurrence_ref', mapping.occurrence_ref)
      .single()
    if (finalProjectionError) throw finalProjectionError
    assert(finalProjection.status === 'closed' && finalProjection.session_revision === closedProjection.session_revision, 'Stale event regressed the closed projection')

    console.log(JSON.stringify({
      isolatedTargets: true,
      migrationsExercised: '001-126',
      rosterSync: synced.roster.outcome,
      scheduleSync: synced.schedule.outcome,
      sessionOpen: opened.outcome,
      studentCheckIn: rawCheckIns[0]!.result.resultCode,
      studentRetry: rawCheckIns[1]!.result.outcome,
      teacherCorrection: corrected.appliedCount,
      correctedStatus: correctedProjection.status,
      sessionClose: closed.outcome,
      closedStudentScan: closedStudent.state,
      duplicateEventAccepted: duplicateEvent.ok && duplicateEvent.value.duplicate,
      reorderedEventIgnored: reorderedEvent.ok && !reorderedEvent.value.projection_applied,
      finalProjection: finalProjection.status,
      deliveredEventCount: capturedEvents.length,
    }, null, 2))
  } finally {
    await new Promise<void>((resolve, reject) => eventServer.close((error) => error ? reject(error) : resolve()))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
