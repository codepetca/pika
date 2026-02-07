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
  const rangeStart = new Date(2026, 1, 2)   // Feb 2
  const rangeEnd = new Date(2026, 5, 30)    // June 30

  // Days with no class
  const excludedDates = new Set([
    '2026-02-16',
    // March break: Mar 16-20
    '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
    '2026-04-03',
    '2026-04-06',
    '2026-05-04',
    '2026-05-18',
    // June 17-30
    ...eachDayOfInterval({ start: new Date(2026, 5, 17), end: new Date(2026, 5, 30) })
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
    .order('email')

  if (studentsErr || !students || students.length !== 2) {
    throw new Error(`Students not found. Run the main seed first: ${formatError(studentsErr)}`)
  }

  console.log(`✓ Found teacher and ${students.length} students\n`)

  // 3. Create the GLD2O Staging classroom
  const calendar = getGLD2OClassDays()

  // Remove existing classroom and dependents to allow re-running
  const { data: existing } = await supabase
    .from('classrooms').select('id').eq('class_code', 'GLD2O1').single()

  if (existing) {
    await supabase.from('assignment_docs').delete().in('assignment_id',
      (await supabase.from('assignments').select('id').eq('classroom_id', existing.id)).data?.map((a: any) => a.id) ?? []
    )
    await supabase.from('assignments').delete().eq('classroom_id', existing.id)
    await supabase.from('lesson_plans').delete().eq('classroom_id', existing.id)
    await supabase.from('class_days').delete().eq('classroom_id', existing.id)
    await supabase.from('classroom_enrollments').delete().eq('classroom_id', existing.id)
    await supabase.from('classroom_roster').delete().eq('classroom_id', existing.id)
    await supabase.from('classrooms').delete().eq('id', existing.id)
  }

  const { data: classroom, error: classroomErr } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: teacher.id,
      title: 'GLD2O Staging',
      class_code: 'GLD2O1',
      term_label: 'Semester 2 2025-2026',
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

  // 7. Create assignments (A1–A10)
  console.log('Creating assignments...')

  const assignments = [
    {
      classroom_id: classroom.id,
      title: 'A1 Getting Started',
      description: 'Practice the course workflow and get comfortable with screenshots and AI tools.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Practice the course workflow and get comfortable with screenshots and AI tools.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Add a short caption under each screenshot explaining what it shows. Crop your screenshots so they only show what\'s relevant.' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Dino Run:' }, { type: 'text', text: ' Play until at least 100 points. Screenshot your score. (To play: turn off Wi-Fi, visit google.com, press spacebar.)' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'YouTube Explorer:' }, { type: 'text', text: ' Search "world\'s shortest video," find the original famous one, and screenshot the page.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Ask AI:' }, { type: 'text', text: ' Ask Google (Gemini) or another AI tool: "What is GLD2O?" Summarize what the AI says (2-3 sentences), then explain how this asynchronous online course is different.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'About you:' }, { type: 'text', text: ' Introduce yourself in a few sentences. Who are you, what are you interested in, and what are you hoping to get out of this course?' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 750 characters (150 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: all four tasks completed in Pika.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: captions are clear; steps followed exactly.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: your own screenshots.' }] }] },
          ]},
        ],
      },
      due_at: '2026-02-06T23:59:00Z',
      position: 0,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A2 Personal Interest Proposal',
      description: 'Propose a personal project you\'ll track through the course.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Propose a personal project you\'ll track through the course (e.g., learn an instrument, start baking, learn to code).' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What you like doing:' }, { type: 'text', text: ' List things you enjoy outside school (hobbies, activities, topics you read/watch).' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Lead-up questions' }, { type: 'text', text: ' (answer briefly):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What makes you curious right now?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'When do you feel "in the zone"?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What\'s a skill you wish you had started earlier?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How much time per week could you give this?' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Your proposal and plan:' }, { type: 'text', text: ' Describe the project you want to pursue and set personal deadlines for yourself. Include:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why it matters to you' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What "done" looks like by course end' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A rough timeline with goals' }] }] },
              ]},
              { type: 'paragraph', content: [{ type: 'text', text: 'It\'s okay if you don\'t know all the steps yet. If your project is new to you, your first milestone might just be researching and exploring what\'s involved. Your plan will probably change as you learn more — that\'s expected. The point is to start with a direction and adjust as you go.' }] },
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'Example: I want to learn to bake. I\'ve never made anything from scratch and I want to change that. I think it would be cool to eventually be able to make something for my friends or family.' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'February: follow a simple recipe and bake something new (banana bread or muffins)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'March: try something harder (cinnamon rolls or a layered cake)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'April: remake something I already tried but make it better' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'May: host friends and serve something I made on my own' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'A typical session:' }, { type: 'text', text: ' Describe what a typical session looks like for this project. What would you actually do? How often would you do it?' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Resources:' }, { type: 'text', text: ' List at least 2 resources (people, sites, videos, tools, AI) you could use.' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 1500 characters (300 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: lead-up questions, proposal with clear timeline, session description, and resources are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: proposal is specific, realistic, and personal; goals are reasonably specific.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-02-13T23:59:00Z',
      position: 1,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A3 Essential Skills',
      description: 'Practice workplace essential skills and show how you apply them.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Practice workplace essential skills and show how you apply them.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'The skills in this assignment come from the Ontario Skills Passport (OSP). To learn more, visit https://www.skillszone.ca' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Skill snapshot:' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Digital skills and AI has increasingly become essential in the workplace. Choose 2 more for a total of 3 skills:' }] },
              { type: 'orderedList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Digital Skills and AI (required)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reading' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Document use' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numeracy' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Writing' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Oral communication' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Working with others' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Computer use' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Continuous learning' }] }] },
              ]},
              { type: 'paragraph', content: [{ type: 'text', text: 'For each of your 3 skills, note:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Where you\'ve used it' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Where it\'s required in a job you\'re interested in' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Reflection' }, { type: 'text', text: ' (4–6 sentences): Why did you choose these 2 skills? Which of your 3 skills is strongest? Which needs the most work? How do you see yourself using these skills in a future job?' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 1000 characters (200 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: skill snapshot (3 skills including Digital skills / AI) and reflection are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: explanations are clear and specific; connections to jobs are relevant.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: organized with headings, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-02-23T23:59:00Z',
      position: 2,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A4 Self-Management & Teamwork',
      description: 'Reflect on how you manage your time and workload, and think about how you work with others.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Reflect on how you manage your time and workload, and think about how you work with others.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Part A: Self-Management' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Pick a course to compare:' }, { type: 'text', text: ' Choose one other course you\'re taking this semester.' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Compare how you manage both courses:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How do you stay on track in this course (GLD2O) vs. the other course?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What\'s different about how you manage your time, workload, or motivation for each?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which course is easier to manage? Why?' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What\'s working:' }, { type: 'text', text: ' What strategies have helped you stay on track? (e.g., scheduling, reminders, workspace, routines)' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What\'s not working:' }, { type: 'text', text: ' Where have you struggled? (e.g., procrastination, distractions, unclear priorities)' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'One change:' }, { type: 'text', text: ' What\'s one specific thing you\'ll do differently for the rest of the semester?' }] }] },
          ]},
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Part B: Teamwork Reflection' }] },
          { type: 'orderedList', attrs: { start: 6 }, content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'A teamwork experience:' }, { type: 'text', text: ' Think of a time you worked with others (group project, job, volunteer work, sports team, club, etc.). Briefly describe the situation.' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What worked and what didn\'t:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What helped the team work well together?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What caused problems or conflict?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How was conflict handled (or not)?' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Diversity in teams:' }, { type: 'text', text: ' How did different perspectives, skills, or backgrounds contribute to the team\'s work?' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Future teamwork:' }, { type: 'text', text: ' What\'s one thing you\'ll do differently next time you work on a team?' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 3000 characters (600 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: all 9 parts (5 self-management + 4 teamwork) are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: specific examples; honest reflection on both self-management and teamwork.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: organized with headings, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-03-06T23:59:00Z',
      position: 3,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A5 Self-Assessment',
      description: 'Learn more about yourself to inform your career exploration.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Learn more about yourself to inform your career exploration.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Take the test:' }, { type: 'text', text: ' Complete the free 16Personalities test at https://www.16personalities.com/free-personality-test' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Screenshot your results:' }, { type: 'text', text: ' Capture your personality type and the brief description. Paste it into your assignment.' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Reflection' }, { type: 'text', text: ' (6–8 sentences):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Does this personality type feel accurate to you? Why or why not?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What surprised you about your results?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How might this personality type influence the kind of work environment or career you\'d enjoy?' }] }] },
              ]},
            ]},
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 800 characters (150 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: screenshot of results and reflection are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: reflection is thoughtful and connects personality to work/learning.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: organized, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-03-13T23:59:00Z',
      position: 4,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A6 Career Exploration',
      description: 'Research occupations and decide which ones fit you best.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Research occupations and decide which ones fit you best.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Choose 2 occupations you genuinely want to learn about. Consider your A5 personality results, but pick roles that interest you.' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Research each role' }, { type: 'text', text: ' (use at least 2 sources per role). Record:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Key duties' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Essential skills required' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Typical education/training' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One local or online opportunity' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whether it could be self-employment, contract, or flexible (remote, flex-time)' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Pathways:' }, { type: 'text', text: ' List courses, certifications, or experiences that would prepare you (school, community, online).' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Fit + barriers:' }, { type: 'text', text: ' For each role, note:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What excites you' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What worries you' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1–2 barriers and strategies to overcome them' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Health & safety' }, { type: 'text', text: ' (for your top choice):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One or two potential workplace hazards' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One health & safety policy workers must follow' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Summary' }, { type: 'text', text: ' (1 paragraph): Pick your top choice and explain why.' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 3500 characters (700 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: research, pathways, barriers, health & safety, and summary present with sources named.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: clear notes; shows comparison and reasoning.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: organized, citations/links to sources, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-04-02T23:59:00Z',
      position: 5,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A7 Decision-Making & Barriers',
      description: 'Apply a decision-making process and plan for barriers.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Apply a decision-making process and plan for barriers.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Choose one decision related to school or work (e.g., course choice, job option, volunteer placement, skill to develop).' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Options and criteria:' }, { type: 'text', text: ' List 3 options and 3–4 criteria that matter to you (cost, time, growth, interest, location, etc.).' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Decision matrix:' }, { type: 'text', text: ' Create a simple table. Score each option against each criterion (1–5 scale) and total the scores.' }] },
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'Example:' }] },
              { type: 'table', content: [
                { type: 'tableRow', content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Criteria' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Option A' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Option B' }] }] },
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Option C' }] }] },
                ]},
                { type: 'tableRow', content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cost' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '5' }] }] },
                ]},
                { type: 'tableRow', content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Interest' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '5' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
                ]},
                { type: 'tableRow', content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Growth' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '5' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4' }] }] },
                ]},
                { type: 'tableRow', content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Total' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '12' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '11' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '12' }] }] },
                ]},
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Barriers and strategies:' }, { type: 'text', text: ' Name 2–3 barriers for your top option (e.g., schedule conflicts, finances, transportation) and how you\'d handle them.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Reflection' }, { type: 'text', text: ' (1 paragraph): Which option did you choose and why? Does the matrix match your gut feeling? What would make you change your mind?' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 1500 characters (300 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: options, criteria, matrix, barriers, and reflection are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: scores explained; reasoning is clear and specific.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: organized layout, visible calculations, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-04-17T23:59:00Z',
      position: 6,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A8 Career Plan & Workplace Awareness',
      description: 'Create a short-term career plan and learn about workplace rights and issues.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Create a short-term career plan and learn about workplace rights and issues.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Career plan:' }, { type: 'text', text: ' Outline your next 2–3 years. Include:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Target pathway (what you\'re working toward)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Key high school courses you\'ll take' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Certifications or experiences to pursue' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One backup plan if things change' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Job posting:' }, { type: 'text', text: ' Find one real posting (part-time, summer, volunteer, or entry-level) that interests you. Paste the key requirements and link.' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Workplace awareness' }, { type: 'text', text: ' (3 short answers):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What is one workplace issue (e.g., harassment, ethics, confidentiality, equity, technology use) that could arise in this job?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What is one worker\'s right relevant to this role (e.g., right to refuse unsafe work, right to accommodation, minimum wage)?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Is this job typically unionized? If yes, name the union; if not, say "not typically unionized."' }] }] },
              ]},
            ]},
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 1000 characters (200 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: career plan, job posting, and workplace awareness are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: plan is realistic and specific; posting matches your interests.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: organized with clear headings, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-04-24T23:59:00Z',
      position: 7,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A9 Job Search Documents',
      description: 'Create a resume and cover letter using AI, and prepare for interviews.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Create a resume and cover letter using AI, and prepare for interviews.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Resume' }, { type: 'text', text: ' (use AI to iterate):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use an AI tool (ChatGPT, Claude, Copilot, etc.) to draft your resume.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Give it the job posting from A8 and your experience/skills.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Paste each draft and note what you asked the AI to change and why.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep refining until you have a resume you\'re proud of.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'You can keep editing after submitting — this is yours to use IRL.' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Cover letter' }, { type: 'text', text: ' (use AI to iterate):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same process: use AI to draft, paste each version, note your changes.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Final version should be targeted to the posting and sound like you.' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Interview prep:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List 2 common interview questions for your target role.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Write brief answers to each.' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note one thing about non-verbal communication (dress, eye contact, body language) that matters for this role.' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Reflection' }, { type: 'text', text: ' (4–6 sentences):' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What do you still need to learn or gain to be competitive for this role?' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What did you learn about using AI for professional documents? (What worked, what didn\'t, what surprised you?)' }] }] },
              ]},
            ]},
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'How to submit: Complete this assignment in Pika.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 4000 characters (800 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: resume, cover letter, interview prep, and reflection are present.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: documents targeted to the posting; AI iteration shows thoughtful refinement.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: multiple drafts visible with notes on changes, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-05-08T23:59:00Z',
      position: 8,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
    {
      classroom_id: classroom.id,
      title: 'A10 Final Portfolio (Google Site)',
      description: 'Showcase your learning in a single, easy-to-navigate Google Site.',
      rich_instructions: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Purpose:' }, { type: 'text', text: ' Showcase your learning in a single, easy-to-navigate Google Site.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What to do:' }] },
          { type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create a new Google Site with clear page names and simple navigation.' }] }] },
            { type: 'listItem', content: [
              { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Required pages:' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Home:' }, { type: 'text', text: ' short intro and "site tour" telling visitors where to find everything' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'About Me:' }, { type: 'text', text: ' profile highlights (strengths, interests, values) and one story that represents you' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Personal Interest Project:' }, { type: 'text', text: ' your project from A2, progress updates, and what you learned' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Essential Skills:' }, { type: 'text', text: ' your skill snapshot and reflection (A3)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Self-Management & Teamwork:' }, { type: 'text', text: ' key takeaways from A4' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Self-Assessment:' }, { type: 'text', text: ' your 16Personalities results and reflection (A5)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Career Exploration:' }, { type: 'text', text: ' summaries of occupations you researched (A6)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Decision-Making & Barriers:' }, { type: 'text', text: ' your decision matrix and strategies (A7)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Career Plan:' }, { type: 'text', text: ' your plan and workplace awareness answers (A8)' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Job Search Documents:' }, { type: 'text', text: ' your resume and cover letter (A9)' }] }] },
              ]},
            ]},
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Final Reflection:' }, { type: 'text', text: ' Add a section (on any page, or its own page) with one paragraph on growth, most useful skill, and next steps. Include 2–3 sentences on how you used AI throughout this course.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'For each page: embed or link your work from Pika. Note what you revised.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Evidence of process:' }, { type: 'text', text: ' include at least 2 in-progress artifacts (drafts, notes, earlier versions) somewhere on the site.' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Progress check:' }, { type: 'text', text: ' There will be a progress check halfway through this assignment. Your site should show significant progress — pages created, content added, and work linked. You don\'t need to be finished, but you should be well underway.' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'What makes a strong portfolio:' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Clear menu, consistent headings, working links' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Your own words and examples' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'All required pages with linked/embedded work' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'How to submit:' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Set sharing so anyone with the link can view.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'In Pika, submit your Site URL + a 4–5 sentence "tour" describing where to find everything.' }] }] },
          ]},
          { type: 'paragraph', content: [{ type: 'text', text: 'Approximate length: 500 characters (100 words)' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Success criteria (/30):' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Completion: all required pages, embedded/linked work, and final reflection.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thinking/communication: navigation is clear; reflection shows growth.' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Workflow/authenticity: evidence of process, working links, your own words.' }] }] },
          ]},
        ],
      },
      due_at: '2026-06-12T23:59:00Z',
      position: 9,
      is_draft: true,
      released_at: null,
      created_by: teacher.id,
    },
  ]

  const { data: createdAssignments, error: assignmentErr } = await supabase
    .from('assignments')
    .insert(assignments)
    .select()

  if (assignmentErr || !createdAssignments) {
    throw new Error(`Insert assignments failed: ${formatError(assignmentErr)}`)
  }
  console.log(`✓ Created ${createdAssignments.length} assignments (A1–A10)\n`)

  // 8. Create lesson plans from calendar data
  console.log('Creating lesson plans...')

  const lessonPlanEntries: Record<string, string> = {
    '2026-02-02': 'A1 Getting Started assigned',
    '2026-02-03': 'A1: All three tasks completed with captions',
    '2026-02-09': 'A2 Personal Interest Proposal assigned',
    '2026-02-10': 'A2: Interests listed and lead-up questions answered',
    '2026-02-12': 'A2: Proposal, session description, and resources done',
    '2026-02-17': 'A3 Essential Skills assigned',
    '2026-02-18': 'A3: 3 skills chosen and skill snapshot started',
    '2026-02-20': 'A3: Reflection written',
    '2026-02-24': 'A4 Self-Management & Teamwork assigned',
    '2026-02-25': 'A4: Course comparison started (Part A)',
    '2026-02-27': 'A4: Part A done — strategies, struggles, and one change',
    '2026-03-02': 'A4: Teamwork experience described (Part B)',
    '2026-03-05': 'A4: Part B done — diversity and future teamwork',
    '2026-03-09': 'A5 Self-Assessment assigned',
    '2026-03-10': 'A5: 16Personalities test taken and results screenshotted',
    '2026-03-12': 'A5: Reflection written',
    '2026-03-23': 'A6 Career Exploration assigned',
    '2026-03-24': 'A6: 2 occupations chosen and research started',
    '2026-03-26': 'A6: Research done for both roles (duties, skills, education, opportunities)',
    '2026-03-30': 'A6: Pathways and fit + barriers sections done',
    '2026-04-01': 'A6: Health & safety and summary paragraph done',
    '2026-04-07': 'A7 Decision-Making & Barriers assigned',
    '2026-04-08': 'A7: Decision chosen, options and criteria listed',
    '2026-04-09': 'A7: Decision matrix built',
    '2026-04-14': 'A7: Barriers and strategies identified',
    '2026-04-16': 'A7: Reflection written',
    '2026-04-20': 'A8 Career Plan & Workplace Awareness assigned',
    '2026-04-21': 'A8: 2–3 year career plan drafted',
    '2026-04-22': 'A8: Job posting found',
    '2026-04-23': 'A8: Workplace awareness questions answered',
    '2026-04-27': 'A9 Job Search Documents assigned',
    '2026-04-28': 'A9: Resume first draft done with AI',
    '2026-04-30': 'A9: Resume refined, cover letter first draft done',
    '2026-05-05': 'A9: Cover letter refined, interview prep done',
    '2026-05-07': 'A9: Reflection written, everything finalized',
    '2026-05-11': 'Personal Interest Focus Week — work on your A2 project and log your progress',
    '2026-05-19': 'A10 Final Portfolio assigned',
    '2026-05-20': 'A10: Google Site created, page structure set up',
    '2026-05-22': 'A10: Home and About Me pages done',
    '2026-05-25': 'A10: Personal Interest Project and Essential Skills pages done',
    '2026-05-27': 'A10: Self-Management and Self-Assessment pages done',
    '2026-05-29': 'A10: Progress check — site should show significant progress',
    '2026-06-01': 'A10: Career Exploration and Decision-Making pages done',
    '2026-06-03': 'A10: Career Plan and Job Search Documents pages done',
    '2026-06-05': 'A10: All pages complete, final reflection started',
    '2026-06-08': 'A10: In-progress artifacts added, all links checked',
    '2026-06-10': 'A10: Final review done',
    '2026-06-12': 'Final portfolios due',
  }

  const lessonPlanRows = Object.entries(lessonPlanEntries).map(([date, text]) => ({
    classroom_id: classroom.id,
    date,
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text }] },
      ],
    },
  }))

  const { error: lessonPlanErr } = await supabase
    .from('lesson_plans')
    .insert(lessonPlanRows)

  if (lessonPlanErr) {
    throw new Error(`Insert lesson_plans failed: ${formatError(lessonPlanErr)}`)
  }
  console.log(`✓ Created ${lessonPlanRows.length} lesson plans\n`)

  // Summary
  console.log('✅ GLD2O Staging seed complete!\n')
  console.log(`  Classroom: ${classroom.title} (${classroom.class_code})`)
  console.log(`  Teacher:   ${teacher.email}`)
  console.log(`  Students:  ${studentEmails.join(', ')}`)
  console.log(`  Assignments: ${createdAssignments.length} (A1–A10)`)
  console.log(`  Lesson plans: ${lessonPlanRows.length}`)
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
