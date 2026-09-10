import { describe, expect, it } from 'vitest'
import { parseSupabaseMigrationDrift } from '../../scripts/parse-supabase-migration-list.mjs'

describe('Supabase migration-list parser', () => {
  it('detects pending migrations in JSON output', () => {
    const output = [
      'Connecting to local database...',
      JSON.stringify({
        migrations: [
          { local: '159', remote: '159', time: '159' },
          { local: '160', remote: '160', time: '160' },
          { local: '161', remote: '', time: '161' },
        ],
        message: 'Migrations listed',
      }),
    ].join('\n')

    expect(parseSupabaseMigrationDrift(output)).toEqual([
      '  files=161 database=missing',
    ])
  })

  it('retains compatibility with table output', () => {
    const output = `
      Local | Remote | Time
      159   | 159    | 159
      160   | 160    | 160
      161   |        | 161
    `

    expect(parseSupabaseMigrationDrift(output)).toEqual([
      '  files=161 database=missing',
    ])
  })

  it('fails closed on unknown output', () => {
    expect(() => parseSupabaseMigrationDrift('Connecting to local database...')).toThrow(
      'Unrecognized Supabase migration-list output'
    )
  })
})
