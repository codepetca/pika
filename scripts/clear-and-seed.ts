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
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false }
})

async function clearAndSeed() {
  console.log('🗑️  Clearing database...\n')

  // Clear data in correct order (respecting foreign keys)
  await supabase.from('assignment_docs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('entries').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('classroom_enrollments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('class_days').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('classrooms').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('verification_codes').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('login_codes').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  console.log('✓ Database cleared\n')
  console.log('🌱 Starting seed process...\n')

  // 1. Create users
  console.log('Creating users...')

  const { data: teacher } = await supabase
    .from('users')
    .insert({ email: 'teacher@yrdsb.ca', role: 'teacher' })
    .select()
    .single()

  const students = []
  for (let i = 1; i <= 3; i++) {
    const { data } = await supabase
      .from('users')
      .insert({ email: `student${i}@student.yrdsb.ca`, role: 'student' })
      .select()
      .single()
    students.push(data)
  }

  console.log(`✓ Created 1 teacher and ${students.length} students\n`)

  // 2. Create classroom
  console.log('Creating classroom...')

  const { data: classroom } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: teacher!.id,
      title: 'GLD2O - Learning Strategies',
      class_code: 'GLD2O1',
      term_label: 'Semester 1 2024-2025',
    })
    .select()
    .single()

  console.log(`✓ Created classroom: ${classroom!.title}\n`)

  // 3. Enroll students
  console.log('Enrolling students...')

  for (const student of students) {
    await supabase
      .from('classroom_enrollments')
      .insert({
        classroom_id: classroom!.id,
        student_id: student!.id,
      })
  }

  console.log(`✓ Enrolled ${students.length} students\n`)

  // 4. Generate class days
  console.log('Generating class days...')

  const dates = generateClassDays('semester1', 2024)
  const classDayRecords = dates.map(date => ({
    classroom_id: classroom!.id,
    date,
    is_class_day: true,
  }))

  await supabase.from('class_days').insert(classDayRecords)

  console.log(`✓ Generated ${dates.length} class days\n`)

  // 5. Create sample entries
  console.log('Creating sample entries...')

  const sampleEntries = [
    // Student 1 - Good attendance (mostly on time)
    {
      student_id: students[0]!.id,
      classroom_id: classroom!.id,
      date: dates[0],
      text: 'Today I learned about functions in JavaScript. I practiced writing arrow functions and understood the difference between function declarations and expressions.',
      minutes_reported: 90,
      mood: '😊',
      on_time: true,
    },
    {
      student_id: students[0]!.id,
      classroom_id: classroom!.id,
      date: dates[1],
      text: 'Worked on array methods like map, filter, and reduce. These are really powerful! I created a small project to practice these concepts.',
      minutes_reported: 120,
      mood: '😊',
      on_time: true,
    },
    {
      student_id: students[0]!.id,
      classroom_id: classroom!.id,
      date: dates[2],
      text: 'Started learning about async/await and promises. This is challenging but I\'m making progress.',
      minutes_reported: 75,
      mood: '🙂',
      on_time: true,
    },

    // Student 2 - Mixed attendance
    {
      student_id: students[1]!.id,
      classroom_id: classroom!.id,
      date: dates[0],
      text: 'Introduction to the course. Reviewed the syllabus and set up my development environment.',
      minutes_reported: 60,
      mood: '🙂',
      on_time: true,
    },
    {
      student_id: students[1]!.id,
      classroom_id: classroom!.id,
      date: dates[1],
      text: 'Sorry for the late submission. Had some technical issues but completed the reading.',
      minutes_reported: 45,
      mood: '😐',
      on_time: false,
    },

    // Student 3 - Poor attendance
    {
      student_id: students[2]!.id,
      classroom_id: classroom!.id,
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

  await supabase.from('entries').insert(entriesWithTimestamps)

  console.log(`✓ Created ${sampleEntries.length} sample entries\n`)

  // Summary
  console.log('✅ Seed completed successfully!\n')
  console.log('Classroom:')
  console.log(`  ${classroom!.title} (${classroom!.class_code})`)
  console.log('\nTest accounts:')
  console.log('  Teacher: teacher@yrdsb.ca')
  console.log('  Student 1: student1@student.yrdsb.ca (good attendance)')
  console.log('  Student 2: student2@student.yrdsb.ca (mixed attendance)')
  console.log('  Student 3: student3@student.yrdsb.ca (poor attendance)')
  console.log('\nUse /api/auth/request-code to get a login code for any email.')
}

clearAndSeed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
