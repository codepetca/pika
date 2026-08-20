import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { seedPlannedCourseFixtures } from './seed-planned-course-fixtures'

const envFile = process.env.ENV_FILE || '.env.local'
config({ path: resolve(process.cwd(), envFile) })

async function seedPlannedCourse() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false },
  })
  const { data: teacher, error } = await supabase
    .from('users')
    .select('id')
    .eq('email', 'teacher@example.com')
    .single()

  if (error || !teacher) {
    throw new Error(`Seed teacher lookup failed: ${error?.message || 'teacher not found'}`)
  }

  await seedPlannedCourseFixtures(supabase, teacher.id)
}

seedPlannedCourse().catch((error) => {
  console.error('Planned course fixture seed failed:', error)
  process.exitCode = 1
})
