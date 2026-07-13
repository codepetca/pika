import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TiptapContent } from '@/types'
import type { TableInsert, TableRow } from '@/types/database'

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('generated Supabase database contract', () => {
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
