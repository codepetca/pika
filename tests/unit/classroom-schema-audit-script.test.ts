import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const scriptPath = resolve(process.cwd(), 'scripts/check-classroom-resource-schema.ts')

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

describe('classroom resource schema audit script', () => {
  it('keeps a hosted database password out of psql arguments and sanitized failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-schema-audit-'))
    const psqlPath = join(directory, 'psql')
    const capturePath = join(directory, 'capture.txt')
    writeFileSync(psqlPath, `#!/bin/sh
printf 'args=%s\naudit_url=%s\npg_host=%s\npg_hostaddr=%s\npg_service=%s\npg_servicefile=%s\ndatabase_url=%s\n' "$*" "$CLASSROOM_SCHEMA_AUDIT_DATABASE_URL" "$PGHOST" "$PGHOSTADDR" "$PGSERVICE" "$PGSERVICEFILE" "$DATABASE_URL" > ${shellQuote(capturePath)}
echo 'fake child error sentinel-password' >&2
exit 1
`)
    chmodSync(psqlPath, 0o700)

    try {
      const result = spawnSync(
        'pnpm',
        ['exec', 'tsx', scriptPath],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            PGHOSTADDR: '127.0.0.1',
            PGSERVICE: 'hostile-service',
            PGSERVICEFILE: '/tmp/hostile-service-file',
            DATABASE_URL:
              'postgresql://postgres:ambient-password@attacker.invalid:5432/postgres',
            CLASSROOM_SCHEMA_AUDIT_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst',
            CLASSROOM_SCHEMA_AUDIT_DATABASE_URL:
              'postgresql://postgres:sentinel-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require',
          },
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toBe(
        'Classroom resource schema query failed for the validated target.\n',
      )
      expect(result.stderr).not.toContain('sentinel-password')
      const capture = readFileSync(capturePath, 'utf8')
      expect(capture).toContain('pg_host=db.abcdefghijklmnopqrst.supabase.co')
      expect(capture).toContain('audit_url=\n')
      expect(capture).toContain('pg_hostaddr=\n')
      expect(capture).toContain('pg_service=\n')
      expect(capture).toContain('pg_servicefile=\n')
      expect(capture).toContain('database_url=\n')
      expect(capture).not.toContain('sentinel-password')
      expect(capture).not.toContain('ambient-password')
      expect(capture).not.toContain('--dbname')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires an explicit hosted or loopback-only mode without echoing the URL', () => {
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', scriptPath],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          CLASSROOM_SCHEMA_AUDIT_EXPECTED_PROJECT_REF: '',
          CLASSROOM_SCHEMA_AUDIT_LOCAL: '',
          CLASSROOM_SCHEMA_AUDIT_DATABASE_URL:
            'postgresql://postgres:sentinel-password@localhost:5432/postgres',
        },
      },
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Set exactly one of')
    expect(result.stderr).not.toContain('sentinel-password')
  })
})
