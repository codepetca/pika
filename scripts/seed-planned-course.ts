import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import {
  PLANNED_COURSE_FIXTURE,
  seedPlannedCourseFixtures,
} from './seed-planned-course-fixtures'

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

  const loadRevision = async () => {
    const { data, error: revisionError } = await supabase
      .from('course_blueprints')
      .select('content_revision')
      .eq('id', PLANNED_COURSE_FIXTURE.blueprintId)
      .single()
    if (revisionError || !data) {
      throw new Error(`Fixture revision lookup failed: ${revisionError?.message || 'not found'}`)
    }
    return data.content_revision
  }

  const revisionBeforeReplay = await loadRevision()
  const replay = await seedPlannedCourseFixtures(supabase, teacher.id)
  const revisionAfterReplay = await loadRevision()
  if (replay.changed || revisionAfterReplay !== revisionBeforeReplay) {
    throw new Error('Planned course fixture replay changed canonical database state')
  }
}

seedPlannedCourse().catch((error) => {
  console.error('Planned course fixture seed failed:', error)
  process.exitCode = 1
})
