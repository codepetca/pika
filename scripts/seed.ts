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

  // 5b. Create entries for yesterday (for log summary cron testing)
  console.log('Creating yesterday entries for log summary testing...')
  const yesterdayDate = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  // Ensure yesterday is a class day
  await supabase.from('class_days').upsert({
    classroom_id: createdClassroom.id,
    date: yesterdayDate,
    is_class_day: true,
  }, { onConflict: 'classroom_id,date' })

  // Delete any existing entries for yesterday
  await supabase.from('entries').delete()
    .eq('classroom_id', createdClassroom.id)
    .eq('date', yesterdayDate)

  const yesterdayEntries = [
    {
      student_id: students[0]!.id,
      classroom_id: createdClassroom.id,
      date: yesterdayDate,
      text: 'Today I worked on my persuasive letter about bike lanes. I\'m having trouble with Student2 because we disagree on the topic. I think the city should prioritize cycling infrastructure, but I\'m not sure how to structure my argument. Can the teacher give us some examples of strong thesis statements? I also spent time reading about urban planning which was really interesting.',
      minutes_reported: 90,
      mood: '🙂' as const,
      on_time: true,
    },
    {
      student_id: students[1]!.id,
      classroom_id: createdClassroom.id,
      date: yesterdayDate,
      text: 'I\'m feeling really frustrated with this course. The assignments are piling up and I don\'t understand the feedback on my narrative essay. Student1 tried to help me but I still don\'t get what "show don\'t tell" means. I think I need extra help from the teacher. On a positive note, I did finish reading the short story for homework.',
      minutes_reported: 60,
      mood: '😟' as const,
      on_time: true,
    },
  ]

  const yesterdayWithTimestamps = yesterdayEntries.map(entry => {
    const baseDate = new Date(entry.date)
    baseDate.setHours(20, 0, 0, 0)
    return {
      ...entry,
      created_at: baseDate.toISOString(),
      updated_at: baseDate.toISOString(),
    }
  })

  ensureOk(await supabase.from('entries').insert(yesterdayWithTimestamps), 'Insert yesterday entries')
  console.log(`✓ Created ${yesterdayEntries.length} entries for ${yesterdayDate}\n`)

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

    const { data: createdDocs, error: docsError } = await supabase
      .from('assignment_docs')
      .insert(assignmentDocs)
      .select('id, assignment_id, student_id')
    if (docsError) {
      console.log(`⚠ Failed to create assignment docs: ${formatSupabaseError(docsError)}`)
    } else {
      console.log(`✓ Created ${createdDocs.length} assignment docs (student work)`)

      // Create assignment_doc_history entries for realistic graph data
      // Rich 10-day history with edge cases: dense bursts, gaps, large pastes,
      // late-night sessions, early-morning starts, heavy deletions, etc.
      console.log('Creating assignment doc history...')

      // Delete existing history for these docs
      await supabase
        .from('assignment_doc_history')
        .delete()
        .in('assignment_doc_id', createdDocs.map(d => d.id))

      // Helper: build a TipTap doc snapshot from paragraphs
      function tiptapDoc(paragraphs: string[]) {
        return {
          type: 'doc',
          content: paragraphs.map(text => ({
            type: 'paragraph',
            content: text ? [{ type: 'text', text }] : [],
          })),
        }
      }

      // Helper: generate an ISO timestamp relative to a base time
      // day = day offset (0 = base day), hour/min/sec in Toronto time (EST = UTC-5)
      function torontoTime(baseMs: number, day: number, hour: number, min: number, sec: number = 0): string {
        // Toronto EST is UTC-5, so add 5 hours to get UTC
        const utcHour = hour + 5
        const dayOffset = day + Math.floor(utcHour / 24)
        const adjustedHour = utcHour % 24
        return new Date(
          baseMs + dayOffset * 86400000 + adjustedHour * 3600000 + min * 60000 + sec * 1000
        ).toISOString()
      }

      interface HistoryStep {
        charCount: number
        wordCount: number
        trigger: string
        day: number
        hour: number
        min: number
        sec?: number
        paste: number | null
        keys: number | null
        snapshot: ReturnType<typeof tiptapDoc> | null
      }

      const historyEntries: {
        assignment_doc_id: string
        patch: null
        snapshot: ReturnType<typeof tiptapDoc> | null
        word_count: number
        char_count: number
        trigger: string
        created_at: string
        paste_word_count: number | null
        keystroke_count: number | null
      }[] = []

      // ── Student 1 narrative essay — 10 days of realistic writing ──
      // Scenarios tested:
      // Day 0: Afternoon start, 4 entries
      // Day 1: Morning burst, 10 rapid entries
      // Day 2: Two sessions (afternoon + evening gap)
      // Day 3: Single quick edit
      // Day 4: Heavy editing — additions and big deletions
      // Day 5: (no activity — gap day)
      // Day 6: Late night session near midnight (3 entries)
      // Day 7: Dense burst — 16 entries in 30 min
      // Day 8: Large paste + cleanup
      // Day 9: Final edits + submit
      const s1NarrativeDoc = createdDocs.find(
        d => d.student_id === students[0]!.id && d.assignment_id === narrative.id
      )
      if (s1NarrativeDoc) {
        // Base: 10 days ago at midnight Toronto time
        const baseDateMs = new Date(now.getTime() - 10 * 86400000).setUTCHours(0, 0, 0, 0)

        const steps: HistoryStep[] = [
          // ── Day 0: Afternoon start (3:00–3:16 PM) — 4 entries ──
          { charCount: 0,   wordCount: 0,   trigger: 'baseline', day: 0, hour: 15, min: 0,  paste: null, keys: null,
            snapshot: tiptapDoc(['']) },
          { charCount: 45,  wordCount: 8,   trigger: 'autosave', day: 0, hour: 15, min: 4,  paste: null, keys: 48,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother']) },
          { charCount: 120, wordCount: 22,  trigger: 'autosave', day: 0, hour: 15, min: 10, paste: null, keys: 80,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising.']) },
          { charCount: 170, wordCount: 32,  trigger: 'blur',     day: 0, hour: 15, min: 16, paste: null, keys: 55,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine.']) },

          // ── Day 1: Morning burst (9:02–9:20 AM) — 10 rapid entries ──
          { charCount: 180, wordCount: 34,  trigger: 'autosave', day: 1, hour: 9,  min: 2,  paste: null, keys: 12,
            snapshot: null },
          { charCount: 210, wordCount: 40,  trigger: 'autosave', day: 1, hour: 9,  min: 4,  paste: null, keys: 35,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said.']) },
          { charCount: 245, wordCount: 46,  trigger: 'autosave', day: 1, hour: 9,  min: 6,  paste: null, keys: 40,
            snapshot: null },
          { charCount: 280, wordCount: 52,  trigger: 'autosave', day: 1, hour: 9,  min: 8,  paste: null, keys: 38,
            snapshot: null },
          { charCount: 310, wordCount: 58,  trigger: 'autosave', day: 1, hour: 9,  min: 10, paste: null, keys: 35,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise.']) },
          { charCount: 340, wordCount: 63,  trigger: 'autosave', day: 1, hour: 9,  min: 12, paste: null, keys: 33,
            snapshot: null },
          { charCount: 375, wordCount: 70,  trigger: 'autosave', day: 1, hour: 9,  min: 14, paste: null, keys: 38,
            snapshot: null },
          { charCount: 395, wordCount: 74,  trigger: 'autosave', day: 1, hour: 9,  min: 16, paste: null, keys: 22,
            snapshot: null },
          { charCount: 420, wordCount: 78,  trigger: 'autosave', day: 1, hour: 9,  min: 18, paste: null, keys: 28,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail.']) },
          { charCount: 440, wordCount: 82,  trigger: 'blur',     day: 1, hour: 9,  min: 20, paste: null, keys: 24,
            snapshot: null },

          // ── Day 2: Two sessions (2:00 PM + 7:30 PM) — 7 entries ──
          // Afternoon session
          { charCount: 455, wordCount: 84,  trigger: 'autosave', day: 2, hour: 14, min: 0,  paste: null, keys: 18,
            snapshot: null },
          { charCount: 480, wordCount: 89,  trigger: 'autosave', day: 2, hour: 14, min: 5,  paste: null, keys: 28,
            snapshot: null },
          { charCount: 460, wordCount: 85,  trigger: 'blur',     day: 2, hour: 14, min: 12, paste: null, keys: 15,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully. The bread came out golden and perfect.']) },
          // Evening session (5.5 hour gap)
          { charCount: 475, wordCount: 88,  trigger: 'autosave', day: 2, hour: 19, min: 30, paste: null, keys: 18,
            snapshot: null },
          { charCount: 510, wordCount: 95,  trigger: 'autosave', day: 2, hour: 19, min: 36, paste: null, keys: 38,
            snapshot: null },
          { charCount: 530, wordCount: 98,  trigger: 'autosave', day: 2, hour: 19, min: 42, paste: null, keys: 24,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her.']) },
          { charCount: 540, wordCount: 100, trigger: 'blur',     day: 2, hour: 19, min: 48, paste: null, keys: 14,
            snapshot: null },

          // ── Day 3: Single quick edit (4:15 PM) — 1 entry ──
          { charCount: 535, wordCount: 99,  trigger: 'autosave', day: 3, hour: 16, min: 15, paste: null, keys: 8,
            snapshot: null },

          // ── Day 4: Heavy editing — additions and deletions (10:00–10:30 AM) — 6 entries ──
          { charCount: 560, wordCount: 104, trigger: 'autosave', day: 4, hour: 10, min: 0,  paste: null, keys: 28,
            snapshot: null },
          { charCount: 490, wordCount: 91,  trigger: 'autosave', day: 4, hour: 10, min: 6,  paste: null, keys: 15,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch. She told me stories about her childhood in Portugal. I listened carefully. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her.']) },
          { charCount: 530, wordCount: 98,  trigger: 'autosave', day: 4, hour: 10, min: 12, paste: null, keys: 45,
            snapshot: null },
          { charCount: 450, wordCount: 83,  trigger: 'autosave', day: 4, hour: 10, min: 18, paste: null, keys: 10,
            snapshot: null },
          { charCount: 520, wordCount: 96,  trigger: 'autosave', day: 4, hour: 10, min: 24, paste: null, keys: 75,
            snapshot: null },
          { charCount: 550, wordCount: 102, trigger: 'blur',     day: 4, hour: 10, min: 30, paste: null, keys: 35,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her. The recipe is more than flour and water.']) },

          // ── Day 5: (no activity) ──

          // ── Day 6: Late night (11:15–11:45 PM) — 3 entries ──
          { charCount: 565, wordCount: 105, trigger: 'autosave', day: 6, hour: 23, min: 15, paste: null, keys: 18,
            snapshot: null },
          { charCount: 590, wordCount: 110, trigger: 'autosave', day: 6, hour: 23, min: 30, paste: null, keys: 28,
            snapshot: null },
          { charCount: 600, wordCount: 112, trigger: 'blur',     day: 6, hour: 23, min: 45, paste: null, keys: 14,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her. The recipe is more than flour and water — it\'s a connection to my family\'s history.']) },

          // ── Day 7: Dense burst with same-minute clusters (1:00–1:30 PM) — 20 entries ──
          // Several saves at 1:03, rapid fire at 1:10–1:11, cluster at 1:20
          { charCount: 605, wordCount: 113, trigger: 'autosave', day: 7, hour: 13, min: 0,  paste: null, keys: 8,
            snapshot: null },
          // 4 saves at 1:03 (10s apart — rapid autosaves)
          { charCount: 610, wordCount: 114, trigger: 'autosave', day: 7, hour: 13, min: 3, sec: 0,  paste: null, keys: 6,
            snapshot: null },
          { charCount: 615, wordCount: 115, trigger: 'autosave', day: 7, hour: 13, min: 3, sec: 12, paste: null, keys: 6,
            snapshot: null },
          { charCount: 618, wordCount: 115, trigger: 'autosave', day: 7, hour: 13, min: 3, sec: 25, paste: null, keys: 4,
            snapshot: null },
          { charCount: 625, wordCount: 116, trigger: 'autosave', day: 7, hour: 13, min: 3, sec: 38, paste: null, keys: 8,
            snapshot: null },
          { charCount: 630, wordCount: 117, trigger: 'autosave', day: 7, hour: 13, min: 6,  paste: null, keys: 6,
            snapshot: null },
          // 6 saves at 1:10–1:11 (rapid typing burst, ~8s apart)
          { charCount: 635, wordCount: 118, trigger: 'autosave', day: 7, hour: 13, min: 10, sec: 0,  paste: null, keys: 6,
            snapshot: null },
          { charCount: 640, wordCount: 119, trigger: 'autosave', day: 7, hour: 13, min: 10, sec: 8,  paste: null, keys: 6,
            snapshot: null },
          { charCount: 643, wordCount: 119, trigger: 'autosave', day: 7, hour: 13, min: 10, sec: 18, paste: null, keys: 4,
            snapshot: null },
          { charCount: 648, wordCount: 120, trigger: 'autosave', day: 7, hour: 13, min: 10, sec: 30, paste: null, keys: 6,
            snapshot: null },
          { charCount: 650, wordCount: 121, trigger: 'autosave', day: 7, hour: 13, min: 10, sec: 42, paste: null, keys: 3,
            snapshot: null },
          { charCount: 655, wordCount: 122, trigger: 'autosave', day: 7, hour: 13, min: 11, sec: 5,  paste: null, keys: 6,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her. The recipe is more than flour and water — it\'s a connection to my family\'s history. That summer taught me that the most important things are passed down.']) },
          { charCount: 660, wordCount: 122, trigger: 'autosave', day: 7, hour: 13, min: 15, paste: null, keys: 6,
            snapshot: null },
          // 5 saves at 1:20 (blur/focus/blur cycle — student switching tabs)
          { charCount: 665, wordCount: 123, trigger: 'blur',     day: 7, hour: 13, min: 20, sec: 0,  paste: null, keys: 6,
            snapshot: null },
          { charCount: 665, wordCount: 123, trigger: 'autosave', day: 7, hour: 13, min: 20, sec: 10, paste: null, keys: 0,
            snapshot: null },
          { charCount: 668, wordCount: 124, trigger: 'autosave', day: 7, hour: 13, min: 20, sec: 22, paste: null, keys: 4,
            snapshot: null },
          { charCount: 670, wordCount: 124, trigger: 'blur',     day: 7, hour: 13, min: 20, sec: 35, paste: null, keys: 3,
            snapshot: null },
          { charCount: 672, wordCount: 125, trigger: 'autosave', day: 7, hour: 13, min: 20, sec: 48, paste: null, keys: 3,
            snapshot: null },
          { charCount: 680, wordCount: 126, trigger: 'autosave', day: 7, hour: 13, min: 25, paste: null, keys: 10,
            snapshot: null },
          { charCount: 690, wordCount: 128, trigger: 'blur',     day: 7, hour: 13, min: 30, paste: null, keys: 14,
            snapshot: null },

          // ── Day 8: Large paste + rapid cleanup saves (8:30–8:50 AM) — 9 entries ──
          { charCount: 950, wordCount: 176, trigger: 'autosave', day: 8, hour: 8,  min: 30, paste: 48, keys: 5,
            snapshot: null },
          // 4 rapid deletes at 8:33 (cutting pasted text, saving every few seconds)
          { charCount: 880, wordCount: 163, trigger: 'autosave', day: 8, hour: 8,  min: 33, sec: 0,  paste: null, keys: 3,
            snapshot: null },
          { charCount: 830, wordCount: 154, trigger: 'autosave', day: 8, hour: 8,  min: 33, sec: 15, paste: null, keys: 2,
            snapshot: null },
          { charCount: 790, wordCount: 147, trigger: 'autosave', day: 8, hour: 8,  min: 33, sec: 28, paste: null, keys: 2,
            snapshot: null },
          { charCount: 750, wordCount: 139, trigger: 'autosave', day: 8, hour: 8,  min: 33, sec: 42, paste: null, keys: 2,
            snapshot: null },
          { charCount: 720, wordCount: 134, trigger: 'autosave', day: 8, hour: 8,  min: 40, paste: null, keys: 8,
            snapshot: null },
          { charCount: 710, wordCount: 132, trigger: 'autosave', day: 8, hour: 8,  min: 45, paste: null, keys: 6,
            snapshot: null },
          { charCount: 700, wordCount: 130, trigger: 'blur',     day: 8, hour: 8,  min: 50, paste: null, keys: 6,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her. The recipe is more than flour and water — it\'s a connection to my family\'s history. That summer taught me that the most important things are passed down not through books, but through hands and hearts.']) },

          // ── Day 9: Final edits + submit (3:00–3:20 PM) — 4 entries ──
          { charCount: 695, wordCount: 129, trigger: 'autosave', day: 9, hour: 15, min: 0,  paste: null, keys: 8,
            snapshot: null },
          { charCount: 680, wordCount: 126, trigger: 'autosave', day: 9, hour: 15, min: 8,  paste: null, keys: 18,
            snapshot: null },
          { charCount: 685, wordCount: 127, trigger: 'autosave', day: 9, hour: 15, min: 14, paste: null, keys: 8,
            snapshot: null },
          { charCount: 680, wordCount: 126, trigger: 'submit',   day: 9, hour: 15, min: 20, paste: null, keys: 6,
            snapshot: tiptapDoc(['The summer I turned twelve, my grandmother taught me how to bake bread. I remember the warm kitchen, the smell of yeast rising, and her flour-dusted hands guiding mine as I kneaded the dough. "Feel the dough," she said. "It will tell you when it\'s ready."', 'That afternoon we sat on the porch waiting for the bread to rise. She told me stories about her childhood in Portugal, about olive groves and fishing boats. I listened carefully, trying to memorize every detail. The bread came out golden and perfect.', 'Now, whenever I bake bread, I think of her. The recipe is more than flour and water — it\'s a connection to my family\'s history. That summer taught me that the most important things are passed down not through books, but through hands and hearts.']) },
        ]
        for (const step of steps) {
          historyEntries.push({
            assignment_doc_id: s1NarrativeDoc.id,
            patch: null,
            snapshot: step.snapshot,
            word_count: step.wordCount,
            char_count: step.charCount,
            trigger: step.trigger,
            created_at: torontoTime(baseDateMs, step.day, step.hour, step.min, step.sec),
            paste_word_count: step.paste,
            keystroke_count: step.keys,
          })
        }
      }

      // ── Student 2 narrative essay — paste-heavy with huge paste + huge delete ──
      // Day 0: Baseline + slow start
      // Day 1: Massive paste (+550 chars — copied from another doc) then trimming
      // Day 2: Massive deletion (-350 chars — cuts most of pasted content) then rebuilds
      // Day 3: Steady writing
      // Day 4: Final edits + submit
      const s2NarrativeDoc = createdDocs.find(
        d => d.student_id === students[1]!.id && d.assignment_id === narrative.id
      )
      if (s2NarrativeDoc) {
        const baseDateMs = new Date(now.getTime() - 5 * 86400000).setUTCHours(0, 0, 0, 0)

        const steps: HistoryStep[] = [
          // Day 0: Slow start (4:00–4:10 PM)
          { charCount: 0,   wordCount: 0,   trigger: 'baseline', day: 0, hour: 16, min: 0,  paste: null, keys: null,
            snapshot: tiptapDoc(['']) },
          { charCount: 30,  wordCount: 6,   trigger: 'autosave', day: 0, hour: 16, min: 5,  paste: null, keys: 35,
            snapshot: tiptapDoc(['Last year I joined the soccer']) },
          { charCount: 85,  wordCount: 16,  trigger: 'blur',     day: 0, hour: 16, min: 10, paste: null, keys: 60,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard.']) },

          // Day 1: Massive paste (+550 chars, clearly from another source) then trimming (11:00–11:30 AM)
          { charCount: 635, wordCount: 118, trigger: 'autosave', day: 1, hour: 11, min: 0,  paste: 100, keys: 5,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit. But my coach said to give it one more week. The drills were exhausting and my legs hurt every day after practice. Some of the other kids were much better than me and it was embarrassing at first. But I kept showing up and eventually I started to improve. My teammates were really supportive and that helped a lot. Soccer taught me discipline and teamwork. Every morning we had to wake up early for conditioning. The coach made us run laps and do push-ups before we even touched a ball. It was brutal but it built character.']) },
          { charCount: 580, wordCount: 107, trigger: 'autosave', day: 1, hour: 11, min: 6,  paste: null, keys: 15,
            snapshot: null },
          { charCount: 520, wordCount: 96,  trigger: 'autosave', day: 1, hour: 11, min: 12, paste: null, keys: 10,
            snapshot: null },
          { charCount: 490, wordCount: 91,  trigger: 'autosave', day: 1, hour: 11, min: 18, paste: null, keys: 8,
            snapshot: null },
          { charCount: 470, wordCount: 87,  trigger: 'blur',     day: 1, hour: 11, min: 30, paste: null, keys: 6,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit. But my coach said to give it one more week. The drills were exhausting and my legs hurt every day after practice. But I kept showing up and eventually I started to improve. My teammates were really supportive and that helped a lot. Soccer taught me discipline and teamwork.']) },

          // Day 2: Massive deletion (-350 chars — realizes pasted text doesn't fit) then starts rewriting (2:00–2:30 PM)
          { charCount: 120, wordCount: 22,  trigger: 'autosave', day: 2, hour: 14, min: 0,  paste: null, keys: 5,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit.']) },
          { charCount: 135, wordCount: 25,  trigger: 'autosave', day: 2, hour: 14, min: 5,  paste: null, keys: 18,
            snapshot: null },
          { charCount: 165, wordCount: 30,  trigger: 'autosave', day: 2, hour: 14, min: 10, paste: null, keys: 35,
            snapshot: null },
          { charCount: 200, wordCount: 37,  trigger: 'autosave', day: 2, hour: 14, min: 16, paste: null, keys: 40,
            snapshot: null },
          { charCount: 250, wordCount: 46,  trigger: 'autosave', day: 2, hour: 14, min: 22, paste: null, keys: 55,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit. But my coach said to give it one more week.', 'The drills were exhausting but I kept showing up. My teammates helped me get better.']) },
          { charCount: 280, wordCount: 52,  trigger: 'blur',     day: 2, hour: 14, min: 30, paste: null, keys: 35,
            snapshot: null },

          // Day 3: Steady writing (7:00–7:30 PM)
          { charCount: 310, wordCount: 57,  trigger: 'autosave', day: 3, hour: 19, min: 0,  paste: null, keys: 35,
            snapshot: null },
          { charCount: 340, wordCount: 63,  trigger: 'autosave', day: 3, hour: 19, min: 8,  paste: null, keys: 35,
            snapshot: null },
          { charCount: 360, wordCount: 67,  trigger: 'autosave', day: 3, hour: 19, min: 16, paste: null, keys: 24,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit. But my coach said to give it one more week.', 'By the end of the season I scored my first goal. It felt amazing. I learned that trying new things is worth it even when it\'s scary at first.']) },
          { charCount: 375, wordCount: 70,  trigger: 'blur',     day: 3, hour: 19, min: 24, paste: null, keys: 18,
            snapshot: null },

          // Day 4: Quick edits + submit (8:00–8:10 AM)
          { charCount: 370, wordCount: 69,  trigger: 'autosave', day: 4, hour: 8,  min: 0,  paste: null, keys: 8,
            snapshot: null },
          { charCount: 380, wordCount: 70,  trigger: 'submit',   day: 4, hour: 8,  min: 10, paste: null, keys: 14,
            snapshot: tiptapDoc(['Last year I joined the soccer team even though I was scared. The first practice was really hard and I wanted to quit. But my coach said to give it one more week.', 'By the end of the season I scored my first goal. It felt amazing. I learned that trying new things is worth it even when it\'s scary at first.']) },
        ]
        for (const step of steps) {
          historyEntries.push({
            assignment_doc_id: s2NarrativeDoc.id,
            patch: null,
            snapshot: step.snapshot,
            word_count: step.wordCount,
            char_count: step.charCount,
            trigger: step.trigger,
            created_at: torontoTime(baseDateMs, step.day, step.hour, step.min, step.sec),
            paste_word_count: step.paste,
            keystroke_count: step.keys,
          })
        }
      }

      // ── Student 1 persuasive letter — in-progress, 3 days ──
      // Day 0: Early morning start (7:30 AM) + late evening continuation (9:00 PM)
      // Day 1: Cluster of 8 entries (lunch hour)
      // Day 2: Short session, still in progress
      const s1LetterDoc = createdDocs.find(
        d => d.student_id === students[0]!.id && d.assignment_id === letter.id
      )
      if (s1LetterDoc) {
        const baseDateMs = new Date(now.getTime() - 3 * 86400000).setUTCHours(0, 0, 0, 0)

        const steps: HistoryStep[] = [
          // Day 0: Early morning (7:30–7:45 AM)
          { charCount: 0,   wordCount: 0,  trigger: 'baseline', day: 0, hour: 7,  min: 30, paste: null, keys: null,
            snapshot: tiptapDoc(['']) },
          { charCount: 25,  wordCount: 5,  trigger: 'autosave', day: 0, hour: 7,  min: 34, paste: null, keys: 28,
            snapshot: tiptapDoc(['Dear Mayor Thompson,']) },
          { charCount: 70,  wordCount: 13, trigger: 'blur',     day: 0, hour: 7,  min: 45, paste: null, keys: 50,
            snapshot: tiptapDoc(['Dear Mayor Thompson,', 'I am writing to you about the lack of bike lanes.']) },
          // Day 0: Late evening (9:00–9:20 PM) — tests start-of-day + end-of-day spread
          { charCount: 130, wordCount: 24, trigger: 'autosave', day: 0, hour: 21, min: 0,  paste: null, keys: 65,
            snapshot: tiptapDoc(['Dear Mayor Thompson,', 'I am writing to you about the lack of bike lanes on Main Street. As a student who rides my bike to school every day, I have seen how dangerous it can be.']) },
          { charCount: 180, wordCount: 33, trigger: 'autosave', day: 0, hour: 21, min: 10, paste: null, keys: 55,
            snapshot: null },
          { charCount: 200, wordCount: 37, trigger: 'blur',     day: 0, hour: 21, min: 20, paste: null, keys: 24,
            snapshot: tiptapDoc(['Dear Mayor Thompson,', 'I am writing to you about the lack of bike lanes on Main Street. As a student who rides my bike to school every day, I have seen how dangerous it can be. Cars pass too closely and there is nowhere safe to ride.']) },

          // Day 1: Lunch hour burst (12:00–12:28 PM) — 8 entries
          { charCount: 210, wordCount: 39, trigger: 'autosave', day: 1, hour: 12, min: 0,  paste: null, keys: 14,
            snapshot: null },
          { charCount: 230, wordCount: 42, trigger: 'autosave', day: 1, hour: 12, min: 4,  paste: null, keys: 24,
            snapshot: null },
          { charCount: 250, wordCount: 46, trigger: 'autosave', day: 1, hour: 12, min: 8,  paste: null, keys: 24,
            snapshot: null },
          { charCount: 240, wordCount: 44, trigger: 'autosave', day: 1, hour: 12, min: 12, paste: null, keys: 8,
            snapshot: null },
          { charCount: 270, wordCount: 50, trigger: 'autosave', day: 1, hour: 12, min: 16, paste: null, keys: 35,
            snapshot: tiptapDoc(['Dear Mayor Thompson,', 'I am writing to you about the lack of bike lanes on Main Street. As a student who rides my bike to school every day, I have seen how dangerous it can be. Cars pass too closely and there is nowhere safe to ride.', 'My friend was nearly hit by a car while biking to school.']) },
          { charCount: 290, wordCount: 54, trigger: 'autosave', day: 1, hour: 12, min: 20, paste: null, keys: 24,
            snapshot: null },
          { charCount: 310, wordCount: 57, trigger: 'autosave', day: 1, hour: 12, min: 24, paste: null, keys: 24,
            snapshot: null },
          { charCount: 320, wordCount: 59, trigger: 'blur',     day: 1, hour: 12, min: 28, paste: null, keys: 14,
            snapshot: tiptapDoc(['Dear Mayor Thompson,', 'I am writing to you about the lack of bike lanes on Main Street. As a student who rides my bike to school every day, I have seen how dangerous it can be. Cars pass too closely and there is nowhere safe to ride.', 'My friend was nearly hit by a car while biking to school. Adding protected bike lanes would make our streets safer for everyone, not just cyclists. Studies show that bike lanes also reduce traffic congestion and improve air quality.']) },

          // Day 2: Short session (3:00–3:10 PM)
          { charCount: 315, wordCount: 58, trigger: 'autosave', day: 2, hour: 15, min: 0,  paste: null, keys: 6,
            snapshot: null },
          { charCount: 325, wordCount: 60, trigger: 'blur',     day: 2, hour: 15, min: 10, paste: null, keys: 14,
            snapshot: null },
        ]
        for (const step of steps) {
          historyEntries.push({
            assignment_doc_id: s1LetterDoc.id,
            patch: null,
            snapshot: step.snapshot,
            word_count: step.wordCount,
            char_count: step.charCount,
            trigger: step.trigger,
            created_at: torontoTime(baseDateMs, step.day, step.hour, step.min, step.sec),
            paste_word_count: step.paste,
            keystroke_count: step.keys,
          })
        }
      }

      if (historyEntries.length > 0) {
        ensureOk(
          await supabase.from('assignment_doc_history').insert(historyEntries),
          'Insert assignment_doc_history'
        )
        console.log(`✓ Created ${historyEntries.length} history entries across 10 days\n`)
      }
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
