/**
 * Seed script: creates the 'GLD2O Staging' classroom for the test teacher
 * and enrolls student1 and student2.
 *
 * Usage: npx tsx scripts/seed-gld2o.ts
 *        ENV_FILE=.env.staging npx tsx scripts/seed-gld2o.ts
 *
 * Prereq: the test teacher and students must already exist (run seed.ts first).
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { eachDayOfInterval, format, isWeekend } from 'date-fns'
import { resolve } from 'path'

const envFile = process.env.ENV_FILE || '.env.local'
config({ path: resolve(process.cwd(), envFile) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false },
})

function formatError(error: any): string {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (error.message) return error.message
  return JSON.stringify(error)
}

function getGLD2OClassDays() {
  const rangeStart = new Date(2025, 1, 2)   // Feb 2
  const rangeEnd = new Date(2025, 5, 30)    // June 30

  // Days with no class (month is 0-indexed)
  const excludedDates = new Set([
    '2025-02-16',
    // March break: Mar 16-20
    '2025-03-16', '2025-03-17', '2025-03-18', '2025-03-19', '2025-03-20',
    '2025-04-03',
    '2025-04-06',
    '2025-05-04',
    '2025-05-18',
    // June 17-30
    ...eachDayOfInterval({ start: new Date(2025, 5, 17), end: new Date(2025, 5, 30) })
      .map(d => format(d, 'yyyy-MM-dd')),
  ])

  const dates = eachDayOfInterval({ start: rangeStart, end: rangeEnd })
    .filter(d => !isWeekend(d))
    .map(d => format(d, 'yyyy-MM-dd'))
    .filter(d => !excludedDates.has(d))

  return { dates, rangeStart, rangeEnd }
}

async function seed() {
  console.log('🌱 Seeding GLD2O Staging classroom...\n')

  // 1. Look up existing teacher
  const { data: teacher, error: teacherErr } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', 'teacher@example.com')
    .single()

  if (teacherErr || !teacher) {
    throw new Error(`Teacher not found. Run the main seed first: ${formatError(teacherErr)}`)
  }

  // 2. Look up existing students
  const studentEmails = ['student1@example.com', 'student2@example.com']
  const { data: students, error: studentsErr } = await supabase
    .from('users')
    .select('id, email')
    .in('email', studentEmails)

  if (studentsErr || !students || students.length !== 2) {
    throw new Error(`Students not found. Run the main seed first: ${formatError(studentsErr)}`)
  }

  console.log(`✓ Found teacher and ${students.length} students\n`)

  // 3. Create the GLD2O Staging classroom
  const calendar = getGLD2OClassDays()

  // Remove existing classroom with this class_code to allow re-running
  await supabase.from('classrooms').delete().eq('class_code', 'GLD2O1')

  const { data: classroom, error: classroomErr } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: teacher.id,
      title: 'GLD2O Staging',
      class_code: 'GLD2O1',
      term_label: 'Semester 2 2024-2025',
      start_date: format(calendar.rangeStart, 'yyyy-MM-dd'),
      end_date: format(calendar.rangeEnd, 'yyyy-MM-dd'),
    })
    .select()
    .single()

  if (classroomErr || !classroom) {
    throw new Error(`Create classroom failed: ${formatError(classroomErr)}`)
  }

  console.log(`✓ Created classroom: ${classroom.title} (${classroom.class_code})\n`)

  // 4. Add students to roster allow-list
  const rosterRows = students.map((s, i) => ({
    classroom_id: classroom.id,
    email: s.email.toLowerCase().trim(),
    student_number: `100${i + 1}`,
    first_name: `Student${i + 1}`,
    last_name: 'Test',
  }))

  const { error: rosterErr } = await supabase
    .from('classroom_roster')
    .upsert(rosterRows, { onConflict: 'classroom_id,email' })

  if (rosterErr) {
    throw new Error(`Roster insert failed: ${formatError(rosterErr)}`)
  }
  console.log(`✓ Added ${students.length} students to roster\n`)

  // 5. Enroll students
  for (const student of students) {
    const { error } = await supabase
      .from('classroom_enrollments')
      .upsert({
        classroom_id: classroom.id,
        student_id: student.id,
      }, { onConflict: 'classroom_id,student_id' })

    if (error) {
      throw new Error(`Enroll ${student.email} failed: ${formatError(error)}`)
    }
  }
  console.log(`✓ Enrolled ${students.length} students\n`)

  // 6. Generate class days
  const classDayRecords = calendar.dates.map((date) => ({
    classroom_id: classroom.id,
    date,
    is_class_day: true,
  }))

  const { error: classDaysErr } = await supabase.from('class_days').insert(classDayRecords)
  if (classDaysErr) {
    throw new Error(`Insert class_days failed: ${formatError(classDaysErr)}`)
  }
  console.log(`✓ Generated ${calendar.dates.length} class days\n`)

  // Summary
  console.log('✅ GLD2O Staging seed complete!\n')
  console.log(`  Classroom: ${classroom.title} (${classroom.class_code})`)
  console.log(`  Teacher:   ${teacher.email}`)
  console.log(`  Students:  ${studentEmails.join(', ')}`)
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
