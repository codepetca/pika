/**
 * Seed script for development/testing
 *
 * Usage: npm run seed
 *
 * This script:
 * 1. Creates test users (1 teacher, 3 students)
 * 2. Generates class days for GLD2O
 * 3. Creates sample entries with varied attendance
 */

import { createClient } from '@supabase/supabase-js'
import { generateClassDays } from '../src/lib/calendar'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('❌ Missing required environment variables:')
  console.error('   - NEXT_PUBLIC_SUPABASE_URL')
  console.error('   - SUPABASE_SECRET_KEY')
  console.error('\nMake sure your .env.local file is configured correctly.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseSecretKey)

async function seed() {
  console.log('🌱 Starting seed process...\n')

  // 1. Create users
  console.log('Creating users...')

  const teacher = await supabase
    .from('users')
    .upsert({
      email: 'teacher@yrdsb.ca',
      role: 'teacher',
    }, { onConflict: 'email' })
    .select()
    .single()

  const students = await Promise.all([
    supabase
      .from('users')
      .upsert({
        email: 'student1@student.yrdsb.ca',
        role: 'student',
      }, { onConflict: 'email' })
      .select()
      .single(),
    supabase
      .from('users')
      .upsert({
        email: 'student2@student.yrdsb.ca',
        role: 'student',
      }, { onConflict: 'email' })
      .select()
      .single(),
    supabase
      .from('users')
      .upsert({
        email: 'student3@student.yrdsb.ca',
        role: 'student',
      }, { onConflict: 'email' })
      .select()
      .single(),
  ])

  console.log(`✓ Created 1 teacher and ${students.length} students\n`)

  // 2. Generate class days
  console.log('Generating class days for GLD2O...')

  const courseCode = 'GLD2O'
  const semester = 'semester1'
  const year = 2024

  const dates = generateClassDays(semester, year)

  const classDayRecords = dates.map(date => ({
    course_code: courseCode,
    date,
    is_class_day: true,
    prompt_text: null,
  }))

  // Delete existing class days for this course
  await supabase
    .from('class_days')
    .delete()
    .eq('course_code', courseCode)

  await supabase
    .from('class_days')
    .insert(classDayRecords)

  console.log(`✓ Generated ${dates.length} class days\n`)

  // 3. Create sample entries
  console.log('Creating sample entries...')

  // Delete existing entries for this course
  await supabase
    .from('entries')
    .delete()
    .eq('course_code', courseCode)

  const sampleEntries = [
    // Student 1 - Good attendance (mostly on time)
    {
      student_id: students[0].data!.id,
      course_code: courseCode,
      date: dates[0],
      text: 'Today I learned about functions in JavaScript. I practiced writing arrow functions and understood the difference between function declarations and expressions. I also completed the coding exercises on callbacks.',
      minutes_reported: 90,
      mood: '😊',
      on_time: true,
    },
    {
      student_id: students[0].data!.id,
      course_code: courseCode,
      date: dates[1],
      text: 'Worked on array methods like map, filter, and reduce. These are really powerful! I created a small project to practice these concepts. Feeling confident about this material.',
      minutes_reported: 120,
      mood: '😊',
      on_time: true,
    },
    {
      student_id: students[0].data!.id,
      course_code: courseCode,
      date: dates[2],
      text: 'Started learning about async/await and promises. This is a bit challenging but I\'m making progress. Watched some tutorial videos and read the documentation.',
      minutes_reported: 75,
      mood: '🙂',
      on_time: true,
    },

    // Student 2 - Mixed attendance (some late, some absent)
    {
      student_id: students[1].data!.id,
      course_code: courseCode,
      date: dates[0],
      text: 'Introduction to the course. Reviewed the syllabus and set up my development environment. Installed VS Code and Node.js.',
      minutes_reported: 60,
      mood: '🙂',
      on_time: true,
    },
    {
      student_id: students[1].data!.id,
      course_code: courseCode,
      date: dates[1],
      text: 'Sorry for the late submission. Had some technical issues but managed to complete the reading. Learned about variables and data types.',
      minutes_reported: 45,
      mood: '😐',
      on_time: false, // Late submission
    },
    // dates[2] missing - absent

    // Student 3 - Poor attendance (mostly absent or late)
    {
      student_id: students[2].data!.id,
      course_code: courseCode,
      date: dates[0],
      text: 'First day. Getting familiar with the course structure and expectations. Need to catch up on some prerequisites.',
      minutes_reported: 30,
      mood: '😟',
      on_time: false, // Late
    },
    // dates[1] missing - absent
    // dates[2] missing - absent
  ]

  // Set timestamps for on_time calculation
  const entriesWithTimestamps = sampleEntries.map(entry => {
    const baseDate = new Date(entry.date)

    if (entry.on_time) {
      // On time: submitted at 8pm
      baseDate.setHours(20, 0, 0, 0)
    } else {
      // Late: submitted at 1am next day
      baseDate.setDate(baseDate.getDate() + 1)
      baseDate.setHours(1, 0, 0, 0)
    }

    return {
      ...entry,
      created_at: baseDate.toISOString(),
      updated_at: baseDate.toISOString(),
    }
  })

  await supabase
    .from('entries')
    .insert(entriesWithTimestamps)

  console.log(`✓ Created ${sampleEntries.length} sample entries\n`)

  // Summary
  console.log('✅ Seed completed successfully!\n')
  console.log('Test accounts:')
  console.log('  Teacher: teacher@yrdsb.ca')
  console.log('  Student 1: student1@student.yrdsb.ca (good attendance)')
  console.log('  Student 2: student2@student.yrdsb.ca (mixed attendance)')
  console.log('  Student 3: student3@student.yrdsb.ca (poor attendance)')
  console.log('\nUse the login page to request a code for any of these emails.')
}

seed().catch(console.error)
