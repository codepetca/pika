/**
 * Seed script for development/testing
 *
 * Usage: npm run seed
 *        ENV_FILE=.env.staging npm run seed
 *
 * This script creates test data without clearing existing data:
 * 1. Creates test users (1 teacher, 2 students)
 * 2. Creates a classroom with enrollments
 * 3. Generates class days for the classroom
 * 4. Creates sample entries with varied attendance
 * 5. Creates sample lesson plans
 */

import { createClient } from '@supabase/supabase-js'
import { generateClassDays, generateClassDaysFromRange, getSemesterDates, getSemesterForDate } from '../src/lib/calendar'
import { hashPassword } from '../src/lib/crypto'
import { getTodayInToronto } from '../src/lib/timezone'
import { config } from 'dotenv'
import { addDays, format, parse, subDays } from 'date-fns'
import { resolve } from 'path'

const envFile = process.env.ENV_FILE || '.env.local'
config({ path: resolve(process.cwd(), envFile) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('❌ Missing required environment variables:')
  console.error('   - NEXT_PUBLIC_SUPABASE_URL')
  console.error('   - SUPABASE_SECRET_KEY')
  console.error('\nMake sure your .env.local file is configured correctly.')
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

async function seed() {
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

  // Delete existing classroom with this class_code first (no unique constraint on class_code)
  await supabase.from('classrooms').delete().eq('class_code', 'TEST01')

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: createdTeacher.id,
      title: 'Test Classroom',
      class_code: 'TEST01',
      term_label: seedCalendar.termLabel,
      start_date: format(seedCalendar.rangeStart, 'yyyy-MM-dd'),
      end_date: format(seedCalendar.rangeEnd, 'yyyy-MM-dd'),
    })
    .select()
    .single()

  if (classroomError) {
    throw new Error(`Create classroom failed: ${formatSupabaseError(classroomError)}`)
  }
  const createdClassroom = ensureData(classroom, 'Create classroom')

  console.log(`✓ Created classroom: ${createdClassroom.title}\n`)

  // 2.5 Add students to classroom roster allow-list
  console.log('Creating classroom roster allow-list...')
  for (let i = 0; i < students.length; i++) {
    const student = students[i]!
    await supabase
      .from('classroom_roster')
      .upsert({
        classroom_id: createdClassroom.id,
        email: student.email.toLowerCase().trim(),
        student_number: `100${i + 1}`,
        first_name: `Student${i + 1}`,
        last_name: 'Test',
      }, { onConflict: 'classroom_id,email' })
  }
  console.log(`✓ Added ${students.length} students to classroom roster\n`)

  // 3. Enroll students
  console.log('Enrolling students...')

  for (const student of students) {
    await supabase
      .from('classroom_enrollments')
      .upsert({
        classroom_id: createdClassroom.id,
        student_id: student.id,
      }, { onConflict: 'classroom_id,student_id' })
  }

  console.log(`✓ Enrolled ${students.length} students\n`)

  // 4. Generate class days
  console.log('Generating class days...')

  const dates = seedCalendar.dates

  // Delete existing class days for this classroom and re-insert
  await supabase.from('class_days').delete().eq('classroom_id', createdClassroom.id)

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
  const entryDates = (pastDates.length >= 3 ? pastDates.slice(-3) : dates.slice(0, 3)).filter(Boolean)

  if (entryDates.length < 3) {
    console.log('⚠ Not enough dates for sample entries, skipping entries')
  } else {
    // Delete existing entries for this classroom
    await supabase.from('entries').delete().eq('classroom_id', createdClassroom.id)

    const sampleEntries = [
      // Student 1 - Good attendance (mostly on time)
      {
        student_id: students[0]!.id,
        classroom_id: createdClassroom.id,
        date: entryDates[0],
        text: 'Today I learned about functions in JavaScript. I practiced writing arrow functions and understood the difference between function declarations and expressions.',
        minutes_reported: 90,
        mood: '😊',
        on_time: true,
      },
      {
        student_id: students[0]!.id,
        classroom_id: createdClassroom.id,
        date: entryDates[1],
        text: 'Worked on array methods like map, filter, and reduce. These are really powerful! I created a small project to practice these concepts.',
        minutes_reported: 120,
        mood: '😊',
        on_time: true,
      },
      {
        student_id: students[0]!.id,
        classroom_id: createdClassroom.id,
        date: entryDates[2],
        text: 'Started learning about async/await and promises. This is challenging but I\'m making progress.',
        minutes_reported: 75,
        mood: '🙂',
        on_time: true,
      },

      // Student 2 - Mixed attendance
      {
        student_id: students[1]!.id,
        classroom_id: createdClassroom.id,
        date: entryDates[0],
        text: 'Introduction to the course. Reviewed the syllabus and set up my development environment.',
        minutes_reported: 60,
        mood: '🙂',
        on_time: true,
      },
      {
        student_id: students[1]!.id,
        classroom_id: createdClassroom.id,
        date: entryDates[1],
        text: 'Sorry for the late submission. Had some technical issues but completed the reading.',
        minutes_reported: 45,
        mood: '😐',
        on_time: false,
      },
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
  }

  // 6. Create sample lesson plans
  console.log('Creating sample lesson plans...')

  // Get the next few class days for lesson plans
  const futureDates = dates.filter(d => d >= todayToronto).slice(0, 5)
  const lessonPlanDates = futureDates.length >= 3 ? futureDates : dates.slice(0, 5)

  // Delete existing lesson plans for this classroom
  await supabase.from('lesson_plans').delete().eq('classroom_id', createdClassroom.id)

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

  const { error: lessonPlanError } = await supabase.from('lesson_plans').insert(sampleLessonPlans)
  if (lessonPlanError) {
    console.log(`⚠ Failed to create lesson plans: ${formatSupabaseError(lessonPlanError)}`)
  } else {
    console.log(`✓ Created ${sampleLessonPlans.length} sample lesson plans\n`)
  }

  // 7. Create sample assignments and student work
  console.log('Creating sample assignments...')

  // Delete existing assignment data for this classroom
  await supabase.from('assignment_docs').delete().in('assignment_id',
    (await supabase.from('assignments').select('id').eq('classroom_id', createdClassroom.id)).data?.map((a: any) => a.id) ?? []
  )
  await supabase.from('assignments').delete().eq('classroom_id', createdClassroom.id)

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
      due_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
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
      due_at: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days from now
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

  const { data: createdAssignments, error: assignmentError } = await supabase
    .from('assignments')
    .insert(assignments)
    .select()

  if (assignmentError) {
    console.log(`⚠ Failed to create assignments: ${formatSupabaseError(assignmentError)}`)
  } else {
    console.log(`✓ Created ${createdAssignments.length} assignments`)

    // Create assignment docs (student work)
    const narrative = createdAssignments[0]!
    const letter = createdAssignments[1]!

    const assignmentDocs = [
      // Student 1 submitted the narrative essay
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
      // Student 2 submitted the narrative essay (late, shorter)
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
        submitted_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), // late
      },
      // Student 1 started the persuasive letter but hasn't submitted
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

    const { error: docsError } = await supabase.from('assignment_docs').insert(assignmentDocs)
    if (docsError) {
      console.log(`⚠ Failed to create assignment docs: ${formatSupabaseError(docsError)}`)
    } else {
      console.log(`✓ Created ${assignmentDocs.length} assignment docs (student work)\n`)
    }
  }

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

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
