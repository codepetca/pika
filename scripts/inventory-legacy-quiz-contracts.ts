import { config } from 'dotenv'
import {
  createSupabaseLegacyQuizInventoryReader,
  inventoryLegacyQuizContracts,
} from '@/lib/server/legacy-quiz-inventory'
import {
  createTargetBoundFetch,
  verifyHostedSupabaseApiOrigin,
} from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

config({ path: process.env.ENV_FILE || '.env.local' })

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const expectedProjectRef = readArgument('--expected-project-ref') ||
    process.env.LEGACY_QUIZ_INVENTORY_EXPECTED_PROJECT_REF
  if (!supabaseUrl || !secretKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  }
  if (!expectedProjectRef) throw new Error('--expected-project-ref is required')

  const verifiedOrigin = verifyHostedSupabaseApiOrigin(supabaseUrl, expectedProjectRef)
  process.env.NEXT_PUBLIC_SUPABASE_URL = verifiedOrigin
  const inventory = await inventoryLegacyQuizContracts(
    createSupabaseLegacyQuizInventoryReader({
      supabase: getServiceRoleClient({
        fetch: createTargetBoundFetch(verifiedOrigin),
      }),
    }),
  )

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      ...inventory,
      target_project_ref: expectedProjectRef,
    }, null, 2)}\n`)
    return
  }

  process.stdout.write(`Legacy Quiz inventory passed for project ${expectedProjectRef}.\n`)
  process.stdout.write(
    `Rows: ${inventory.row_counts.quizzes} quizzes, ` +
    `${inventory.row_counts.quiz_questions} questions, ` +
    `${inventory.row_counts.quiz_responses} responses, ` +
    `${inventory.row_counts.quiz_student_scores} score overrides, ` +
    `${inventory.row_counts.quiz_assessment_drafts} Quiz drafts, and ` +
    `${inventory.row_counts.quiz_blueprint_assessments} Quiz blueprint assessments.\n`,
  )
  process.stdout.write(
    `Archives: ${inventory.archives.total} verified metadata rows; ` +
    `${inventory.archives.quiz_resource_evidence.quizzes.archives_with_rows} contain Quiz rows.\n`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown inventory failure'
  process.stderr.write(`Legacy Quiz inventory failed: ${message}\n`)
  process.exitCode = 1
})
