/**
 * Clear and reseed script for development/testing
 *
 * Usage: tsx scripts/clear-and-seed.ts
 *
 * This script:
 * 1. Clears all data from relevant tables
 * 2. Creates test users (1 teacher, 3 students)
 * 3. Creates a classroom with enrollments
 * 4. Generates class days for the classroom
 * 5. Creates sample entries with varied attendance
 */

import { createClient } from '@supabase/supabase-js'
import { generateClassDays, generateClassDaysFromRange, getSemesterDates, getSemesterForDate } from '../src/lib/calendar'
import { hashPassword } from '../src/lib/crypto'
import { getTodayInToronto } from '../src/lib/timezone'
import { seedAssignmentReviewFixtures } from './seed-assignment-review-fixtures'
import { seedSampleTests } from './seed-tests'
import { config } from 'dotenv'
import { addDays, format, parse, subDays } from 'date-fns'
import { resolve } from 'path'

const envFile = process.env.ENV_FILE || '.env.local'
config({ path: resolve(process.cwd(), envFile) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!
const allowDbWipe = process.env.ALLOW_DB_WIPE === 'true'

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

if (!allowDbWipe) {
  console.error('❌ Refusing to wipe database.')
  console.error(`   This script deletes data from Supabase: ${supabaseUrl}`)
  console.error(`   To proceed, set ALLOW_DB_WIPE=true in ${envFile} (or export it in your shell).`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false }
})

function formatSupabaseError(error: any): string {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (error.message) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function ensureData<T>(data: T | null, label: string): T {
  if (!data) {
    throw new Error(`${label} returned no data`)
  }
  return data
}

function ensureOk(result: { error: any }, label: string) {
  if (result.error) {
    throw new Error(`${label} failed: ${formatSupabaseError(result.error)}`)
  }
}

function getSeedCalendar() {
  const todayToronto = parse(getTodayInToronto(), 'yyyy-MM-dd', new Date())
  const thisYear = todayToronto.getFullYear()

  let semesterYear = thisYear
  let semester = getSemesterForDate(todayToronto, thisYear)
  if (!semester) {
    semester = getSemesterForDate(todayToronto, thisYear - 1)
    if (semester) semesterYear = thisYear - 1
  }

  if (semester) {
    const { start, end } = getSemesterDates(semester, semesterYear)
    const dates = generateClassDays(semester, semesterYear)
    const schoolYearStart = semester === 'semester1' ? semesterYear : semesterYear - 1
    const schoolYearEnd = semester === 'semester1' ? semesterYear + 1 : semesterYear
    const semesterLabel = semester === 'semester1' ? 'Semester 1' : 'Semester 2'
    return {
      dates,
      rangeStart: start,
      rangeEnd: end,
      termLabel: `${semesterLabel} ${schoolYearStart}-${schoolYearEnd}`,
    }
  }

  // Summer (Jul/Aug) isn't inside either semester; use a short rolling range for dev/testing.
  const rangeStart = subDays(todayToronto, 14)
  const rangeEnd = addDays(todayToronto, 120)
  const dates = generateClassDaysFromRange(rangeStart, rangeEnd)
  return {
    dates,
    rangeStart,
    rangeEnd,
    termLabel: `Custom ${format(rangeStart, 'yyyy-MM-dd')} to ${format(rangeEnd, 'yyyy-MM-dd')}`,
  }
}

async function clearAndSeed() {
  console.log('🗑️  Clearing database...\n')

  // Clear data in correct order (respecting foreign keys)
  ensureOk(
    await supabase.from('assignment_feedback_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete assignment_feedback_entries'
  )
  ensureOk(
    await supabase.from('assignment_repo_targets').delete().neq('assignment_id', '00000000-0000-0000-0000-000000000000'),
    'Delete assignment_repo_targets'
  )
  ensureOk(
    await supabase.from('assignment_repo_review_results').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete assignment_repo_review_results'
  )
  ensureOk(
    await supabase.from('assignment_repo_review_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete assignment_repo_review_runs'
  )
  ensureOk(
    await supabase.from('assignment_docs').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete assignment_docs'
  )
  ensureOk(
    await supabase.from('assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete assignments'
  )
  ensureOk(
    await supabase.from('entries').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete entries'
  )
  ensureOk(
    await supabase.from('lesson_plans').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete lesson_plans'
  )
  ensureOk(
    await supabase.from('classroom_resources').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete classroom_resources'
  )
  ensureOk(
    await supabase.from('classroom_enrollments').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete classroom_enrollments'
  )
  ensureOk(
    await supabase.from('classroom_roster').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete classroom_roster'
  )
  ensureOk(
    await supabase.from('student_profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete student_profiles'
  )
  ensureOk(
    await supabase.from('class_days').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete class_days'
  )
  ensureOk(
    await supabase.from('classrooms').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete classrooms'
  )
  ensureOk(
    await supabase.from('verification_codes').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete verification_codes'
  )
  ensureOk(
    await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    'Delete users'
  )

  console.log('✓ Database cleared\n')
  console.log('🌱 Starting seed process...\n')

  // 1. Create users with password
  console.log('Creating users...')

  const password = 'test1234'
  const passwordHash = await hashPassword(password)

  const { data: teacher, error: teacherError } = await supabase
    .from('users')
    .upsert({
      email: 'teacher@example.com',
      role: 'teacher',
      password_hash: passwordHash
    }, { onConflict: 'email' })
    .select('id, email')
    .single()

  if (teacherError) {
    throw new Error(`Create teacher failed: ${formatSupabaseError(teacherError)}`)
  }
  const createdTeacher = ensureData(teacher, 'Create teacher')

  const students = []
  for (let i = 1; i <= 2; i++) {
    const { data, error } = await supabase
      .from('users')
      .upsert({
        email: `student${i}@example.com`,
        role: 'student',
        password_hash: passwordHash
      }, { onConflict: 'email' })
      .select('id, email')
      .single()

    if (error) {
      throw new Error(`Create student${i} failed: ${formatSupabaseError(error)}`)
    }
    students.push(ensureData(data, `Create student${i}`))
  }

  console.log('Creating student profiles...')
  for (let i = 0; i < students.length; i++) {
    const student = students[i]!
    await supabase
      .from('student_profiles')
      .upsert({
        user_id: student.id,
        student_number: `100${i + 1}`,
        first_name: `Student${i + 1}`,
        last_name: 'Test',
      }, { onConflict: 'user_id' })
  }
  console.log('✓ Created student profiles\n')

  console.log(`✓ Created 1 teacher and ${students.length} students\n`)

  // 2. Create classroom
  console.log('Creating classroom...')

  const seedCalendar = getSeedCalendar()

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: createdTeacher.id,
      title: 'Test Classroom',
      class_code: 'TEST01',
      term_label: seedCalendar.termLabel,
    })
    .select()
    .single()

  if (classroomError) {
    throw new Error(`Create classroom failed: ${formatSupabaseError(classroomError)}`)
  }
  const createdClassroom = ensureData(classroom, 'Create classroom')

  const { error: calendarRangeError } = await supabase
    .from('classrooms')
    .update({
      start_date: format(seedCalendar.rangeStart, 'yyyy-MM-dd'),
      end_date: format(seedCalendar.rangeEnd, 'yyyy-MM-dd'),
    })
    .eq('id', createdClassroom.id)

  if (calendarRangeError) {
    throw new Error(
      `Update classroom calendar range failed: ${formatSupabaseError(calendarRangeError)} (did you run supabase migrations?)`
    )
  }

  console.log(`✓ Created classroom: ${createdClassroom.title}\n`)

  // 2.5 Add students to classroom roster allow-list
  console.log('Creating classroom roster allow-list...')
  await supabase
    .from('classroom_roster')
    .insert(students.map((student, index) => ({
      classroom_id: classroom!.id,
      email: student!.email.toLowerCase().trim(),
      student_number: `100${index + 1}`,
      first_name: `Student${index + 1}`,
      last_name: 'Test',
    })))
  console.log(`✓ Added ${students.length} students to classroom roster\n`)

  // 3. Enroll students
  console.log('Enrolling students...')

  for (const student of students) {
    const result = await supabase
      .from('classroom_enrollments')
      .insert({
        classroom_id: createdClassroom.id,
        student_id: student.id,
      })
    ensureOk(result, `Enroll ${student.email}`)
  }

  console.log(`✓ Enrolled ${students.length} students\n`)

  // 4. Generate class days
  console.log('Generating class days...')

  const dates = seedCalendar.dates
  const classDayRecords = dates.map((date) => ({
    classroom_id: createdClassroom.id,
    date,
    is_class_day: true,
  }))

  ensureOk(await supabase.from('class_days').insert(classDayRecords), 'Insert class_days')

  console.log(`✓ Generated ${dates.length} class days\n`)

  // 5. Create sample entries
  console.log('Creating sample entries...')

  const todayToronto = getTodayInToronto()
  const pastDates = dates.filter(d => d <= todayToronto)
  const desiredEntryCount = 12
  const entryDates = (
    pastDates.length >= desiredEntryCount
      ? pastDates.slice(-desiredEntryCount)
      : dates.slice(0, desiredEntryCount)
  ).filter(Boolean)

  if (entryDates.length < 6) {
    throw new Error('Seed calendar did not produce enough dates for sample entries')
  }

  const studentOneLogTexts = [
    'Set up the course notebook, checked the classroom resources, and made sure my development tools were ready for the term.',
    'Practiced variables, conditionals, and trace tables. The trace table helped me slow down and catch a mistake before I ran the code.',
    'Built a small checklist page and connected the buttons to state. I still need to clean up the naming, but the interaction works now.',
    'Today I wrote a longer reflection on debugging. I started with a layout bug that looked like a CSS problem, but it turned out the data I expected was never reaching the component. I used console output first, then narrowed the issue by checking one function at a time. The important part was writing down what I expected before changing code. I also helped compare two approaches for the same task: one with repeated conditionals and one with a small helper function. The helper version was easier to read because it named the decision directly. My next step is to practice explaining the cause of a bug in one sentence before I fix it, because that makes the fix less random.',
    'Reviewed array methods with map, filter, and reduce. Reduce is still the trickiest because I have to track the accumulator carefully.',
    'Worked on an async example that fetches data and shows loading, success, and error states. I had to test the error state twice to make sure it actually appeared.',
    'I spent most of class revising a project log after peer feedback. The first version only listed what I did, so I rewrote it to explain what changed, why it changed, and what evidence showed the change worked. I included the bug where my empty state showed at the wrong time, then described how I traced it to a stale boolean. This was a useful reminder that a log is more helpful when it captures a decision, not just a task list. I also added a short note about what I would do differently next time: write the empty, loading, and loaded states before styling the page.',
    'Finished the lesson on functions and parameters. I can explain the difference between passing a value and returning a value more clearly now.',
    'Started planning the final mini-project. I sketched the main screen, wrote down the data I need, and picked one feature to build first instead of trying everything at once.',
    'Today was a heavy writing day. I documented the project plan, including the problem, the users, the minimum version, and the stretch ideas. The hardest part was cutting the plan down to something realistic. I originally listed five features, but after checking the time left I moved two of them into a later section. I also wrote acceptance checks for the first feature: the user can add an item, edit it, mark it done, and still see it after refresh. Having those checks made the task feel less vague. I want to keep using that format because it gives me a clear way to know when something is actually finished. I also wrote a risk list for the parts that could take longer than expected. The biggest risks are saving data, handling empty states, and making the layout work on a phone. For each one I wrote a fallback plan so I do not get stuck: save to local state first, show a simple empty message, and keep the mobile layout stacked if the split view feels too tight. This entry is intentionally long because I want to test how the history list handles a student writing several connected thoughts instead of a short sentence.',
    'Tested the project in a smaller browser width and found two text wrapping problems. I fixed one and wrote a note for the other.',
    'Submitted today with a short demo of the working feature. I am happy with the progress, but I still want to refactor one repeated block tomorrow.',
  ]

  const studentTwoLogTexts = [
    'Joined late but reviewed the starter files and got the local project running.',
    'Completed the variables practice and wrote down two questions about naming conventions.',
    'Had trouble with array methods today. I understand map when the example is small, but I get lost when the callback has more than one step. I tried rewriting the callback as a regular function first, which made it easier to read. I also compared my output to the sample output after each change instead of waiting until the end. That helped me find one place where I returned the wrong property. I need more practice, but I can at least explain what each method is supposed to do now.',
    'Worked with a partner on the layout challenge. We divided the work so one person handled structure and one handled spacing.',
    'Read through feedback on my last entry and added more detail about the problem I was solving.',
    'Missed part of the demonstration because of connection problems. I caught up by reading the notes and rebuilding the example slowly.',
    'This was a long catch-up session. I went back through three older tasks, compared them to the checklist, and marked what was actually complete. One task looked finished visually but did not handle an empty list, so I added an empty message and tested it. Another task saved the right data but used confusing variable names, so I renamed them after checking that the behavior stayed the same. The main thing I learned is that catching up is easier when I separate missing code, unclear code, and untested code instead of treating everything as one big problem.',
    'Prepared questions for next class about project scope and how to decide when a helper function is worth adding.',
  ]

  const sampleEntries = [
    ...entryDates.map((date, index) => ({
      student_id: students[0]!.id,
      classroom_id: createdClassroom.id,
      date,
      text: studentOneLogTexts[index % studentOneLogTexts.length],
      minutes_reported: 60 + ((index % 5) * 15),
      mood: (index % 4 === 3 ? '😐' : index % 2 === 0 ? '😊' : '🙂'),
      on_time: true,
    })),
    ...entryDates.slice(-studentTwoLogTexts.length).map((date, index) => ({
      student_id: students[1]!.id,
      classroom_id: createdClassroom.id,
      date,
      text: studentTwoLogTexts[index],
      minutes_reported: 45 + ((index % 4) * 15),
      mood: (index % 3 === 2 ? '😐' : '🙂'),
      on_time: index !== 0 && index !== 5,
    })),
  ]

  const entriesWithTimestamps = sampleEntries.map(entry => {
    const baseDate = new Date(entry.date)
    if (entry.on_time) {
      baseDate.setHours(20, 0, 0, 0)
    } else {
      baseDate.setDate(baseDate.getDate() + 1)
      baseDate.setHours(1, 0, 0, 0)
    }
    return {
      ...entry,
      created_at: baseDate.toISOString(),
      updated_at: baseDate.toISOString(),
    }
  })

  ensureOk(await supabase.from('entries').insert(entriesWithTimestamps), 'Insert entries')

  console.log(`✓ Created ${sampleEntries.length} sample entries\n`)

  // 6. Create sample lesson plans
  console.log('Creating sample lesson plans...')

  // Include last class plus the next few class days for lesson plans.
  const lastClassLessonPlanDate = pastDates.filter(d => d < todayToronto).slice(-1)[0]
  const futureDates = dates.filter(d => d >= todayToronto).slice(0, 5)
  const lessonPlanCandidates = [lastClassLessonPlanDate, ...futureDates].filter(
    (date): date is string => Boolean(date)
  )
  const lessonPlanDates =
    lessonPlanCandidates.length >= 3
      ? Array.from(new Set(lessonPlanCandidates)).slice(0, 5)
      : dates.slice(0, 5)

  const sampleLessonPlans = lessonPlanDates.map((date, index) => ({
    classroom_id: createdClassroom.id,
    date,
    content: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: `Day ${index + 1}: Sample Lesson` }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `This is a sample lesson plan for ${date}.` }]
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Learning objective 1' }] }]
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Learning objective 2' }] }]
            },
          ]
        }
      ]
    }
  }))

  ensureOk(await supabase.from('lesson_plans').insert(sampleLessonPlans), 'Insert lesson_plans')

  console.log(`✓ Created ${sampleLessonPlans.length} sample lesson plans\n`)

  // 7. Create sample assignments and student work
  console.log('Creating sample assignments...')

  const now = new Date()
  const assignments = [
    {
      classroom_id: createdClassroom.id,
      title: 'Personal Narrative Essay',
      description: 'Write a 3-paragraph personal narrative about a meaningful experience.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Write a 3-paragraph personal narrative about a meaningful experience in your life.' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Include sensory details and dialogue' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use a clear beginning, middle, and end' }] }] },
          ]},
        ],
      },
      due_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      position: 0,
      is_draft: false,
      released_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: createdTeacher.id,
    },
    {
      classroom_id: createdClassroom.id,
      title: 'Persuasive Letter',
      description: 'Write a persuasive letter to a community leader about an issue you care about.',
      rich_instructions: null,
      due_at: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      position: 1,
      is_draft: false,
      released_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      created_by: createdTeacher.id,
    },
    {
      classroom_id: createdClassroom.id,
      title: 'Poetry Analysis (Draft)',
      description: 'Analyze a poem of your choice.',
      rich_instructions: null,
      due_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      position: 2,
      is_draft: true,
      released_at: null,
      created_by: createdTeacher.id,
    },
  ]

  const { data: createdAssignments } = await supabase
    .from('assignments')
    .insert(assignments)
    .select()

  ensureOk({ error: createdAssignments ? null : 'no data' }, 'Insert assignments')
  console.log(`✓ Created ${createdAssignments!.length} assignments`)

  const narrative = createdAssignments![0]!
  const letter = createdAssignments![1]!

  const assignmentDocs = [
    {
      assignment_id: narrative.id,
      student_id: students[0]!.id,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail. The bread came out golden and perfect.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Now, whenever I bake bread, I think of her. The recipe is more than flour and water — it\'s a connection to my family\'s history. That summer taught me that the most important things are passed down not through books, but through hands and hearts.' }] },
        ],
      },
      is_submitted: true,
      submitted_at: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      assignment_id: narrative.id,
      student_id: students[1]!.id,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit. But my coach said to give it one more week.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'By the end of the season I scored my first goal. It felt amazing. I learned that trying new things is worth it even when it\'s scary at first.' }] },
        ],
      },
      is_submitted: true,
      submitted_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      assignment_id: letter.id,
      student_id: students[0]!.id,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Dear Mayor Thompson,' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'I am writing to you about the lack of bike lanes on Main Street. As a student who rides my bike to school every day, I have seen how dangerous it can be...' }] },
        ],
      },
      is_submitted: false,
      submitted_at: null,
    },
  ]

  ensureOk(await supabase.from('assignment_docs').insert(assignmentDocs), 'Insert assignment_docs')
  console.log(`✓ Created ${assignmentDocs.length} assignment docs (student work)\n`)

  await seedAssignmentReviewFixtures({
    supabase,
    classroomId: createdClassroom.id,
    teacherId: createdTeacher.id,
    students: students.map((student) => ({
      id: student.id,
      email: student.email,
    })),
    assignments: {
      narrative,
      letter,
    },
    now,
  })
  console.log('✓ Added repo artifact, repo review, and feedback-return fixtures\n')

  await seedSampleTests({
    supabase,
    classroomId: createdClassroom.id,
    teacherId: createdTeacher.id,
    students: students.map((student) => ({
      id: student.id,
      email: student.email,
    })),
  })

  // Summary
  console.log('✅ Seed completed successfully!\n')
  console.log('Classroom:')
  console.log(`  ${createdClassroom.title} (${createdClassroom.class_code})`)
  console.log('\nTest accounts (password: test1234):')
  console.log('  Teacher: teacher@example.com')
  console.log('  Student 1: student1@example.com (good attendance)')
  console.log('  Student 2: student2@example.com (mixed attendance)')
  console.log('\nLogin at /login with email + password.')
}

clearAndSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
