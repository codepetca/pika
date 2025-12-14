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
import { generateClassDays } from '../src/lib/calendar'
import { hashPassword } from '../src/lib/crypto'
import { config } from 'dotenv'
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

async function clearAndSeed() {
  console.log('🗑️  Clearing database...\n')

  // Clear data in correct order (respecting foreign keys)
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
      email: 'teacher@yrdsb.ca',
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
  for (let i = 1; i <= 3; i++) {
    const { data, error } = await supabase
      .from('users')
      .upsert({
        email: `student${i}@student.yrdsb.ca`,
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

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: createdTeacher.id,
      title: 'GLD2O - Learning Strategies',
      class_code: 'GLD2O1',
      term_label: 'Semester 1 2024-2025',
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

  const dates = generateClassDays('semester1', 2024)
  const classDayRecords = dates.map(date => ({
    classroom_id: createdClassroom.id,
    date,
    is_class_day: true,
  }))

  ensureOk(await supabase.from('class_days').insert(classDayRecords), 'Insert class_days')

  console.log(`✓ Generated ${dates.length} class days\n`)

  // 5. Create sample entries
  console.log('Creating sample entries...')

  const sampleEntries = [
    // Student 1 - Good attendance (mostly on time)
    {
      student_id: students[0]!.id,
      classroom_id: createdClassroom.id,
      date: dates[0],
      text: 'Today I learned about functions in JavaScript. I practiced writing arrow functions and understood the difference between function declarations and expressions.',
      minutes_reported: 90,
      mood: '😊',
      on_time: true,
    },
    {
      student_id: students[0]!.id,
      classroom_id: createdClassroom.id,
      date: dates[1],
      text: 'Worked on array methods like map, filter, and reduce. These are really powerful! I created a small project to practice these concepts.',
      minutes_reported: 120,
      mood: '😊',
      on_time: true,
    },
    {
      student_id: students[0]!.id,
      classroom_id: createdClassroom.id,
      date: dates[2],
      text: 'Started learning about async/await and promises. This is challenging but I\'m making progress.',
      minutes_reported: 75,
      mood: '🙂',
      on_time: true,
    },

    // Student 2 - Mixed attendance
    {
      student_id: students[1]!.id,
      classroom_id: createdClassroom.id,
      date: dates[0],
      text: 'Introduction to the course. Reviewed the syllabus and set up my development environment.',
      minutes_reported: 60,
      mood: '🙂',
      on_time: true,
    },
    {
      student_id: students[1]!.id,
      classroom_id: createdClassroom.id,
      date: dates[1],
      text: 'Sorry for the late submission. Had some technical issues but completed the reading.',
      minutes_reported: 45,
      mood: '😐',
      on_time: false,
    },

    // Student 3 - Poor attendance
    {
      student_id: students[2]!.id,
      classroom_id: createdClassroom.id,
      date: dates[0],
      text: 'First day. Getting familiar with the course structure.',
      minutes_reported: 30,
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

  // Summary
  console.log('✅ Seed completed successfully!\n')
  console.log('Classroom:')
  console.log(`  ${createdClassroom.title} (${createdClassroom.class_code})`)
  console.log('\nTest accounts (password: test1234):')
  console.log('  Teacher: teacher@yrdsb.ca')
  console.log('  Student 1: student1@student.yrdsb.ca (good attendance)')
  console.log('  Student 2: student2@student.yrdsb.ca (mixed attendance)')
  console.log('  Student 3: student3@student.yrdsb.ca (poor attendance)')
  console.log('\nLogin options:')
  console.log('  POST /api/auth/login with email + password')
}

clearAndSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
