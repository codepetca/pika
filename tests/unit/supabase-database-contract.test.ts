import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TiptapContent } from '@/types'
import type { Database, TableInsert, TableRow } from '@/types/database'
import type { Database as GeneratedDatabase } from '@/types/database.generated'

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('generated Supabase database contract', () => {
  it('refines only the generated draft-save expected version nullability', () => {
    type RawArgs = GeneratedDatabase['public']['Functions']['finish_test_draft_save_for_owner_v1']['Args']
    type Args = Database['public']['Functions']['finish_test_draft_save_for_owner_v1']['Args']
    expectTypeOf<Args['p_expected_version']>().toEqualTypeOf<number | null>()
    expectTypeOf<Omit<Args, 'p_expected_version'>>().toEqualTypeOf<Omit<RawArgs, 'p_expected_version'>>()
    expect(readRepoFile('src/types/database.ts')).toContain(
      "Replace<GeneratedFunctions['finish_test_draft_save_for_owner_v1']['Args']"
    )
  })

  it('refines only the installed counselor RPC nullable input without inventing its signature', () => {
    type RawArgs = GeneratedDatabase['public']['Functions']['update_classroom_roster_counselor_for_owner_v1']['Args']
    type Args = Database['public']['Functions']['update_classroom_roster_counselor_for_owner_v1']['Args']
    expectTypeOf<Args['p_counselor_email']>().toEqualTypeOf<string | null>()
    expectTypeOf<Omit<Args, 'p_counselor_email'>>().toEqualTypeOf<Omit<RawArgs, 'p_counselor_email'>>()
    const source = readRepoFile('src/types/database.ts')
    expect(source).toContain("Replace<GeneratedFunctions['update_classroom_roster_counselor_for_owner_v1']['Args']")
  })

  it('types both central Supabase client factories', () => {
    const source = readRepoFile('src/lib/supabase.ts')

    expect(source).toContain("import type { Database } from '@/types/database'")
    expect(source.match(/createClient<Database>/g)).toHaveLength(2)
  })

  it('refines generated JSON columns with application domain contracts', () => {
    expectTypeOf<TableRow<'assignment_docs'>['content']>().toEqualTypeOf<TiptapContent>()
    expectTypeOf<TableInsert<'test_ai_grading_runs'>['requested_student_ids_json']>()
      .toEqualTypeOf<string[] | undefined>()
    expectTypeOf<TableInsert<'classwork_materials'>['position']>()
      .toEqualTypeOf<number | undefined>()
  })

  it('keeps generation and drift checks as explicit package commands', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['db:types:generate']).toBe(
      'bash scripts/supabase-types.sh generate'
    )
    expect(packageJson.scripts?.['db:types:check']).toBe(
      'bash scripts/supabase-types.sh check'
    )
    expect(readRepoFile('scripts/supabase-types.sh')).toContain(
      'supabase migration list --local'
    )
  })

  it('replays migrations in ephemeral CI before checking generated type drift', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml')
    const databaseStartIndex = workflow.indexOf('supabase start ')
    const typeCheckIndex = workflow.indexOf('pnpm run db:types:check')

    expect(workflow).toContain('name: Architecture Database Contracts')
    expect(databaseStartIndex).toBeGreaterThan(-1)
    expect(typeCheckIndex).toBeGreaterThan(databaseStartIndex)
  })
})
