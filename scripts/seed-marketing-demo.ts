import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { addDays, format, parse, subDays } from 'date-fns'
import { generateClassDaysFromRange, getSemesterDates, getSemesterForDate } from '../src/lib/calendar'
import { hashPassword } from '../src/lib/crypto'
import { getTodayInToronto } from '../src/lib/timezone'

type DemoStudent = {
  email: string
  firstName: string
  lastName: string
  studentNumber: string
  attendancePattern: 'strong' | 'steady' | 'at-risk'
}

type DemoClassroom = {
  title: string
  classCode: string
  termLabel: string
  startDate: string
  endDate: string
}

const envFile = process.env.ENV_FILE || '.env.local'
config({ path: resolve(process.cwd(), envFile) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false },
})

const TEACHER_EMAIL = 'teacher.marketing@example.com'
const DEFAULT_PASSWORD = 'test1234'
const DEMO_CLASS_CODES = ['MKT101', 'MKT201']
const ALLOW_MARKETING_SEED = process.env.ALLOW_MARKETING_SEED === 'true'
const ALLOW_MARKETING_SEED_PRODUCTION = process.env.ALLOW_MARKETING_SEED_PRODUCTION === 'true'

const demoStudents: DemoStudent[] = [
  { email: 'ava.chen@example.com', firstName: 'Ava', lastName: 'Chen', studentNumber: '24001', attendancePattern: 'strong' },
  { email: 'liam.patel@example.com', firstName: 'Liam', lastName: 'Patel', studentNumber: '24002', attendancePattern: 'steady' },
  { email: 'noah.martinez@example.com', firstName: 'Noah', lastName: 'Martinez', studentNumber: '24003', attendancePattern: 'strong' },
  { email: 'emma.kim@example.com', firstName: 'Emma', lastName: 'Kim', studentNumber: '24004', attendancePattern: 'steady' },
  { email: 'olivia.nguyen@example.com', firstName: 'Olivia', lastName: 'Nguyen', studentNumber: '24005', attendancePattern: 'strong' },
  { email: 'ethan.brown@example.com', firstName: 'Ethan', lastName: 'Brown', studentNumber: '24006', attendancePattern: 'at-risk' },
  { email: 'mia.rodriguez@example.com', firstName: 'Mia', lastName: 'Rodriguez', studentNumber: '24007', attendancePattern: 'steady' },
  { email: 'lucas.wilson@example.com', firstName: 'Lucas', lastName: 'Wilson', studentNumber: '24008', attendancePattern: 'strong' },
  { email: 'sofia.khan@example.com', firstName: 'Sofia', lastName: 'Khan', studentNumber: '24009', attendancePattern: 'steady' },
  { email: 'jack.thompson@example.com', firstName: 'Jack', lastName: 'Thompson', studentNumber: '24010', attendancePattern: 'at-risk' },
  { email: 'isabella.lee@example.com', firstName: 'Isabella', lastName: 'Lee', studentNumber: '24011', attendancePattern: 'strong' },
  { email: 'henry.clark@example.com', firstName: 'Henry', lastName: 'Clark', studentNumber: '24012', attendancePattern: 'steady' },
]

function asRichDoc(paragraphs: string[]) {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  }
}

function moodForPattern(pattern: DemoStudent['attendancePattern']) {
  if (pattern === 'strong') return '🙂'
  if (pattern === 'at-risk') return '😟'
  return '😊'
}

function minutesForPattern(pattern: DemoStudent['attendancePattern']) {
  if (pattern === 'strong') return 95
  if (pattern === 'at-risk') return 45
  return 70
}

function shouldSubmitEntry(pattern: DemoStudent['attendancePattern'], dayIndex: number) {
  if (pattern === 'strong') return true
  if (pattern === 'at-risk') return dayIndex % 2 === 0
  return dayIndex !== 1
}

function classWindow() {
  const today = parse(getTodayInToronto(), 'yyyy-MM-dd', new Date())
  const start = subDays(today, 35)
  const end = addDays(today, 70)

  const semester = getSemesterForDate(today, today.getFullYear()) ?? getSemesterForDate(today, today.getFullYear() - 1)
  let termLabel = `Custom ${format(start, 'yyyy-MM-dd')} to ${format(end, 'yyyy-MM-dd')}`

  if (semester) {
    const year = getSemesterForDate(today, today.getFullYear()) ? today.getFullYear() : today.getFullYear() - 1
    const semesterDates = getSemesterDates(semester, year)
    const schoolYearStart = semester === 'semester1' ? year : year - 1
    const schoolYearEnd = semester === 'semester1' ? year + 1 : year
    const semesterLabel = semester === 'semester1' ? 'Semester 1' : 'Semester 2'
    termLabel = `${semesterLabel} ${schoolYearStart}-${schoolYearEnd}`
    return { start: semesterDates.start, end: semesterDates.end, termLabel }
  }

  return { start, end, termLabel }
}

function throwIfError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? 'unknown error'}`)
  }
}

function assertSeedSafety() {
  if (!ALLOW_MARKETING_SEED) {
    throw new Error('Refusing to seed marketing demo data. Set ALLOW_MARKETING_SEED=true to continue.')
  }

  if (process.env.NODE_ENV === 'production' && !ALLOW_MARKETING_SEED_PRODUCTION) {
    throw new Error('Refusing to run in production mode. Set ALLOW_MARKETING_SEED_PRODUCTION=true to continue.')
  }
}

async function removeExistingDemoData(teacherId: string) {
  const { data: existingClassrooms, error } = await supabase
    .from('classrooms')
    .select('id,class_code')
    .eq('teacher_id', teacherId)
    .in('class_code', DEMO_CLASS_CODES)

  throwIfError(error, 'Failed loading existing demo classrooms')
  if (!existingClassrooms || existingClassrooms.length === 0) return

  const classIds = existingClassrooms.map((row) => row.id)

  const { data: assignments, error: assignmentsError } = await supabase
    .from('assignments')
    .select('id')
    .in('classroom_id', classIds)
  throwIfError(assignmentsError, 'Failed loading assignments for cleanup')

  const assignmentIds = (assignments ?? []).map((row) => row.id)

  if (assignmentIds.length > 0) {
    const { data: docs, error: docsError } = await supabase
      .from('assignment_docs')
      .select('id')
      .in('assignment_id', assignmentIds)
    throwIfError(docsError, 'Failed loading assignment docs for cleanup')

    const docIds = (docs ?? []).map((row) => row.id)

    if (docIds.length > 0) {
      const { error: historyDeleteError } = await supabase.from('assignment_doc_history').delete().in('assignment_doc_id', docIds)
      throwIfError(historyDeleteError, 'Failed deleting assignment_doc_history')
    }

    const { error: docsDeleteError } = await supabase.from('assignment_docs').delete().in('assignment_id', assignmentIds)
    throwIfError(docsDeleteError, 'Failed deleting assignment_docs')

    const { error: assignmentsDeleteError } = await supabase.from('assignments').delete().in('id', assignmentIds)
    throwIfError(assignmentsDeleteError, 'Failed deleting assignments')
  }

  const { error: entriesDeleteError } = await supabase.from('entries').delete().in('classroom_id', classIds)
  throwIfError(entriesDeleteError, 'Failed deleting entries')

  const { error: lessonPlansDeleteError } = await supabase.from('lesson_plans').delete().in('classroom_id', classIds)
  throwIfError(lessonPlansDeleteError, 'Failed deleting lesson_plans')

  const { error: classDaysDeleteError } = await supabase.from('class_days').delete().in('classroom_id', classIds)
  throwIfError(classDaysDeleteError, 'Failed deleting class_days')

  const { error: enrollmentsDeleteError } = await supabase.from('classroom_enrollments').delete().in('classroom_id', classIds)
  throwIfError(enrollmentsDeleteError, 'Failed deleting classroom_enrollments')

  const { error: rosterDeleteError } = await supabase.from('classroom_roster').delete().in('classroom_id', classIds)
  throwIfError(rosterDeleteError, 'Failed deleting classroom_roster')

  const { error: classroomsDeleteError } = await supabase.from('classrooms').delete().in('id', classIds)
  throwIfError(classroomsDeleteError, 'Failed deleting classrooms')
}

async function seedMarketingDemo() {
  assertSeedSafety()
  console.log('Seeding marketing demo data...')

  const passwordHash = await hashPassword(DEFAULT_PASSWORD)

  const { data: teacher, error: teacherError } = await supabase
    .from('users')
    .upsert({
      email: TEACHER_EMAIL,
      role: 'teacher',
      password_hash: passwordHash,
      email_verified_at: new Date().toISOString(),
    }, { onConflict: 'email' })
    .select('id,email')
    .single()

  if (teacherError || !teacher) {
    throw new Error(`Failed creating teacher: ${teacherError?.message ?? 'no data'}`)
  }

  await removeExistingDemoData(teacher.id)

  const createdStudents: Array<{ id: string; email: string; profile: DemoStudent }> = []

  for (const student of demoStudents) {
    const { data, error } = await supabase
      .from('users')
      .upsert({
        email: student.email,
        role: 'student',
        password_hash: passwordHash,
        email_verified_at: new Date().toISOString(),
      }, { onConflict: 'email' })
      .select('id,email')
      .single()

    if (error || !data) {
      throw new Error(`Failed creating ${student.email}: ${error?.message ?? 'no data'}`)
    }

    const { error: profileError } = await supabase.from('student_profiles').upsert({
      user_id: data.id,
      student_number: student.studentNumber,
      first_name: student.firstName,
      last_name: student.lastName,
    }, { onConflict: 'user_id' })
    throwIfError(profileError, `Failed upserting student profile for ${student.email}`)

    createdStudents.push({ id: data.id, email: data.email, profile: student })
  }

  const window = classWindow()
  const startDate = format(window.start, 'yyyy-MM-dd')
  const endDate = format(window.end, 'yyyy-MM-dd')

  const classroomSeeds: DemoClassroom[] = [
    { title: 'Pika Demo - English 10', classCode: 'MKT101', termLabel: window.termLabel, startDate, endDate },
    { title: 'Pika Demo - Learning Strategies', classCode: 'MKT201', termLabel: window.termLabel, startDate, endDate },
  ]

  const createdClassrooms: Array<{ id: string; title: string; classCode: string }> = []

  for (const classroom of classroomSeeds) {
    const { data, error } = await supabase
      .from('classrooms')
      .insert({
        teacher_id: teacher.id,
        title: classroom.title,
        class_code: classroom.classCode,
        term_label: classroom.termLabel,
        start_date: classroom.startDate,
        end_date: classroom.endDate,
        allow_enrollment: true,
      })
      .select('id,title,class_code')
      .single()

    if (error || !data) {
      throw new Error(`Failed creating classroom ${classroom.classCode}: ${error?.message ?? 'no data'}`)
    }

    createdClassrooms.push({ id: data.id, title: data.title, classCode: data.class_code })

    const { error: rosterError } = await supabase.from('classroom_roster').upsert(
      createdStudents.map((student) => ({
        classroom_id: data.id,
        email: student.email,
        student_number: student.profile.studentNumber,
        first_name: student.profile.firstName,
        last_name: student.profile.lastName,
      })),
      { onConflict: 'classroom_id,email' }
    )
    throwIfError(rosterError, `Failed upserting roster for ${classroom.classCode}`)

    const { error: enrollmentError } = await supabase.from('classroom_enrollments').upsert(
      createdStudents.map((student) => ({
        classroom_id: data.id,
        student_id: student.id,
      })),
      { onConflict: 'classroom_id,student_id' }
    )
    throwIfError(enrollmentError, `Failed upserting enrollments for ${classroom.classCode}`)

    const classDays = generateClassDaysFromRange(window.start, window.end)
    const { error: classDayError } = await supabase.from('class_days').insert(
      classDays.map((date) => ({
        classroom_id: data.id,
        date,
        is_class_day: true,
      }))
    )
    throwIfError(classDayError, `Failed inserting class days for ${classroom.classCode}`)
  }

  const primaryClass = createdClassrooms[0]
  const secondaryClass = createdClassrooms[1]

  if (!primaryClass || !secondaryClass) {
    throw new Error('Expected two classrooms')
  }

  const allClassDays = generateClassDaysFromRange(window.start, window.end)
  const recentDays = allClassDays.filter((d) => d <= getTodayInToronto()).slice(-6)

  const dailyPrompts = [
    'Today I focused on drafting and revising one clear claim.',
    'I reviewed feedback and rewrote a paragraph for stronger evidence.',
    'I finished a short reflection and planned my next draft session.',
    'I practiced sentence clarity and removed repeated ideas.',
    'I used a checklist to improve structure and transitions.',
    'I reflected on what strategy helped me write faster and better.',
  ]

  const entries: Array<Record<string, unknown>> = []
  for (const day of recentDays) {
    for (const [index, student] of createdStudents.entries()) {
      if (!shouldSubmitEntry(student.profile.attendancePattern, recentDays.indexOf(day))) {
        continue
      }

      const onTime = student.profile.attendancePattern !== 'at-risk' || index % 3 !== 0
      const createdAt = new Date(`${day}T${onTime ? '20:15:00' : '01:20:00'}.000Z`).toISOString()
      entries.push({
        student_id: student.id,
        classroom_id: primaryClass.id,
        date: day,
        text: `${dailyPrompts[recentDays.indexOf(day)]} (${student.profile.firstName} ${student.profile.lastName})`,
        minutes_reported: minutesForPattern(student.profile.attendancePattern),
        mood: moodForPattern(student.profile.attendancePattern),
        on_time: onTime,
        created_at: createdAt,
        updated_at: createdAt,
      })
    }
  }

  if (entries.length > 0) {
    const { error: entriesError } = await supabase.from('entries').insert(entries)
    throwIfError(entriesError, 'Failed inserting entries')
  }

  const now = new Date()
  const teacherEmailForGrading = TEACHER_EMAIL

  const primaryAssignments = [
    {
      classroom_id: primaryClass.id,
      title: 'Personal Narrative: A Moment That Changed Me',
      description: 'Write a personal narrative with concrete sensory detail and reflection.',
      rich_instructions: asRichDoc([
        'Write a 3-paragraph personal narrative about a meaningful moment in your life.',
        'Include sensory details, dialogue, and a clear reflection at the end.',
      ]),
      due_at: subDays(now, 3).toISOString(),
      position: 0,
      is_draft: false,
      released_at: subDays(now, 11).toISOString(),
      created_by: teacher.id,
      track_authenticity: true,
    },
    {
      classroom_id: primaryClass.id,
      title: 'Argument Paragraph: Community Issue',
      description: 'Make a clear claim and support it with evidence and reasoning.',
      rich_instructions: asRichDoc([
        'Choose one local issue and write an argument paragraph with one claim and two supporting reasons.',
        'Use concise topic and closing sentences.',
      ]),
      due_at: addDays(now, 4).toISOString(),
      position: 1,
      is_draft: false,
      released_at: subDays(now, 2).toISOString(),
      created_by: teacher.id,
      track_authenticity: true,
    },
    {
      classroom_id: primaryClass.id,
      title: 'Quick Reflection Check-in',
      description: 'Short weekly reflection to support consistent attendance habits.',
      rich_instructions: null,
      due_at: addDays(now, 8).toISOString(),
      position: 2,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
      track_authenticity: true,
    },
  ]

  const secondaryAssignments = [
    {
      classroom_id: secondaryClass.id,
      title: 'Learning Plan Snapshot',
      description: 'Outline two goals and one support strategy for this week.',
      rich_instructions: null,
      due_at: addDays(now, 2).toISOString(),
      position: 0,
      is_draft: false,
      released_at: subDays(now, 3).toISOString(),
      created_by: teacher.id,
      track_authenticity: true,
    },
  ]

  const { data: createdAssignments, error: assignmentError } = await supabase
    .from('assignments')
    .insert([...primaryAssignments, ...secondaryAssignments])
    .select('id,title,classroom_id')

  if (assignmentError || !createdAssignments) {
    throw new Error(`Failed creating assignments: ${assignmentError?.message ?? 'no data'}`)
  }

  const narrative = createdAssignments.find((a) => a.title.includes('Personal Narrative'))
  const argument = createdAssignments.find((a) => a.title.includes('Argument Paragraph'))
  const learningPlan = createdAssignments.find((a) => a.title.includes('Learning Plan'))

  if (!narrative || !argument || !learningPlan) {
    throw new Error('Failed to map created assignments')
  }

  const docs: Array<Record<string, unknown>> = []

  for (const [index, student] of createdStudents.entries()) {
    const narrativeSubmitted = index < 10
    const narrativeGraded = index < 7
    const narrativeReturned = index < 5

    docs.push({
      assignment_id: narrative.id,
      student_id: student.id,
      content: asRichDoc([
        `${student.profile.firstName} drafted a personal narrative about building confidence through a small challenge.`,
        'The piece includes sensory details, dialogue, and a short reflection at the end.',
      ]),
      is_submitted: narrativeSubmitted,
      submitted_at: narrativeSubmitted ? subDays(now, 2).toISOString() : null,
      score_completion: narrativeGraded ? 7 + (index % 3) : null,
      score_thinking: narrativeGraded ? 6 + (index % 4) : null,
      score_workflow: narrativeGraded ? 7 + (index % 2) : null,
      feedback: narrativeGraded ? 'Clear growth in structure and detail. Keep tightening transitions.' : null,
      graded_at: narrativeGraded ? subDays(now, 1).toISOString() : null,
      graded_by: narrativeGraded ? teacherEmailForGrading : null,
      returned_at: narrativeReturned ? subDays(now, 1).toISOString() : null,
      authenticity_score: 86 + (index % 10),
      authenticity_flags: [],
      viewed_at: narrativeReturned ? subDays(now, 1).toISOString() : null,
    })

    const argumentStarted = index < 11
    const argumentSubmitted = index < 6

    docs.push({
      assignment_id: argument.id,
      student_id: student.id,
      content: argumentStarted
        ? asRichDoc([
            'Claim: Our school should add one quiet study block each week.',
            'Reasoning: Students can catch up, reduce stress, and improve assignment quality.',
          ])
        : asRichDoc(['']),
      is_submitted: argumentSubmitted,
      submitted_at: argumentSubmitted ? subDays(now, 1).toISOString() : null,
      score_completion: null,
      score_thinking: null,
      score_workflow: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      returned_at: null,
      authenticity_score: argumentSubmitted ? 91 : null,
      authenticity_flags: [],
      viewed_at: null,
    })

    docs.push({
      assignment_id: learningPlan.id,
      student_id: student.id,
      content: asRichDoc([
        'Goal 1: submit all daily check-ins before 9pm.',
        'Goal 2: revise one writing piece with teacher feedback this week.',
        'Support strategy: use a 20-minute timer before each class day deadline.',
      ]),
      is_submitted: index < 9,
      submitted_at: index < 9 ? subDays(now, 1).toISOString() : null,
      score_completion: null,
      score_thinking: null,
      score_workflow: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      returned_at: null,
      authenticity_score: null,
      authenticity_flags: null,
      viewed_at: null,
    })
  }

  const { data: createdDocs, error: docsError } = await supabase
    .from('assignment_docs')
    .insert(docs)
    .select('id,student_id,assignment_id')

  if (docsError || !createdDocs) {
    throw new Error(`Failed creating assignment docs: ${docsError?.message ?? 'no data'}`)
  }

  const historyDocs = createdDocs.filter((doc, idx) => idx < 4)
  if (historyDocs.length > 0) {
    const historyRows: Array<Record<string, unknown>> = []

    for (const [docIndex, doc] of historyDocs.entries()) {
      for (let dayOffset = 4; dayOffset >= 0; dayOffset -= 1) {
        historyRows.push({
          assignment_doc_id: doc.id,
          patch: null,
          snapshot: asRichDoc([
            `Revision snapshot ${5 - dayOffset} for marketing demo doc ${docIndex + 1}.`,
            'This simulates writing progression over multiple days.',
          ]),
          word_count: 90 + docIndex * 12 + (4 - dayOffset) * 10,
          char_count: 520 + docIndex * 30 + (4 - dayOffset) * 45,
          trigger: dayOffset === 0 ? 'submit' : 'autosave',
          created_at: subDays(now, dayOffset).toISOString(),
          paste_word_count: dayOffset === 2 ? 18 : null,
          keystroke_count: 40 + docIndex * 6,
        })
      }
    }

    const { error: historyInsertError } = await supabase.from('assignment_doc_history').insert(historyRows)
    throwIfError(historyInsertError, 'Failed inserting assignment_doc_history')
  }

  console.log('Done.')
  console.log('Teacher account:')
  console.log(`  ${TEACHER_EMAIL}`)
  console.log(`  password: ${DEFAULT_PASSWORD}`)
  console.log('Sample student account:')
  console.log(`  ${demoStudents[0]?.email}`)
  console.log(`  password: ${DEFAULT_PASSWORD}`)
  console.log('Created classrooms:')
  for (const classroom of createdClassrooms) {
    console.log(`  ${classroom.title} (${classroom.classCode})`)
  }
}

seedMarketingDemo()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
