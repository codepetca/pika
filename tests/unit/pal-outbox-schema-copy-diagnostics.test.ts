import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const dockerMock = `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == ps ]]; then
  printf 'supabase_db_pika\\n'
  exit 0
fi
[[ "$1" == exec ]] || exit 90
command_name=''
interactive=false
for argument in "$@"; do
  case "$argument" in
    createdb|dropdb|pg_dump|psql) command_name="$argument" ;;
    -i) interactive=true ;;
  esac
done
case "$command_name" in
  createdb) printf 'createdb\\n' >> "$PAL_TEST_EVENTS" ;;
  dropdb) printf 'dropdb\\n' >> "$PAL_TEST_EVENTS" ;;
  pg_dump)
    printf 'export\\n' >> "$PAL_TEST_EVENTS"
    printf 'SET log_min_messages = warning;\\nCREATE SCHEMA extensions;\\nCREATE SCHEMA vault;\\n%s\\n' "$PAL_TEST_PRIVATE_MARKER"
    printf '%s exporter stderr\\n' "$PAL_TEST_PRIVATE_MARKER" >&2
    exit "$PAL_TEST_EXPORT_STATUS"
    ;;
  psql)
    if [[ "$interactive" == false ]]; then
      printf 'setup\\n' >> "$PAL_TEST_EVENTS"
    elif [[ ! -e "$PAL_TEST_INPUT" ]]; then
      printf 'import\\n' >> "$PAL_TEST_EVENTS"
      cat > "$PAL_TEST_INPUT"
      printf '%s importer stdout\\n' "$PAL_TEST_PRIVATE_MARKER"
      printf '%s importer stderr\\n' "$PAL_TEST_PRIVATE_MARKER" >&2
      exit "$PAL_TEST_IMPORT_STATUS"
    else
      printf 'bootstrap\\n' >> "$PAL_TEST_EVENTS"
      # Stop after successful schema copy; no fixture/migration/claim runs.
      exit 73
    fi
    ;;
  *) exit 91 ;;
esac
`

const sedMock = `#!/usr/bin/env bash
set -euo pipefail
/usr/bin/sed "$@"
printf '%s filter stderr\\n' "$PAL_TEST_PRIVATE_MARKER" >&2
exit "$PAL_TEST_FILTER_STATUS"
`

function runHarness(exporter: number, filter: number, importer: number, closeStderr = false) {
  const directory = mkdtempSync(join(tmpdir(), 'pika-pal-schema-test-'))
  chmodSync(directory, 0o700)
  try {
    const events = join(directory, 'events')
    const input = join(directory, 'input')
    const marker = 'SYNTHETIC_PRIVATE_SCHEMA_AND_ERROR_MARKER'
    writeFileSync(join(directory, 'docker'), dockerMock, { mode: 0o700 })
    writeFileSync(join(directory, 'sed'), sedMock, { mode: 0o700 })
    writeFileSync(events, '', { mode: 0o600 })
    const script = resolve('scripts/check-pal-outbox-concurrency.sh')
    const args = closeStderr
      ? ['-c', 'exec 2>&-; exec bash "$1"', 'pal-schema-diagnostics', script]
      : [script]
    const result = spawnSync('bash', args, {
      cwd: process.cwd(),
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        HOME: directory,
        LANG: 'C',
        PAL_OUTBOX_CONCURRENCY_DATABASE_NAME: 'synthetic_pal_schema_test',
        PAL_TEST_EVENTS: events,
        PAL_TEST_INPUT: input,
        PAL_TEST_PRIVATE_MARKER: marker,
        PAL_TEST_EXPORT_STATUS: String(exporter),
        PAL_TEST_FILTER_STATUS: String(filter),
        PAL_TEST_IMPORT_STATUS: String(importer),
      },
      encoding: 'utf8',
      timeout: 5_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.stdout).toBe('')
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker)
    expect(readFileSync(input, 'utf8')).toBe(`${marker}\n`)
    return {
      status: result.status,
      stderr: result.stderr,
      events: readFileSync(events, 'utf8').trim().split('\n'),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('Pal schema-copy failure diagnostics', () => {
  it.each([
    { exporter: 7, filter: 0, importer: 0, status: 7 },
    { exporter: 0, filter: 9, importer: 0, status: 9 },
    { exporter: 0, filter: 0, importer: 3, status: 3 },
    { exporter: 7, filter: 9, importer: 3, status: 3 },
    { exporter: 0, filter: 0, importer: 255, status: 255 },
  ])('preserves pipefail status $status for $exporter/$filter/$importer', ({ exporter, filter, importer, status }) => {
    const result = runHarness(exporter, filter, importer)
    expect(result.status).toBe(status)
    expect(result.stderr).toBe(`DIAG pal-outbox stage=schema-copy exporter=${exporter} filter=${filter} importer=${importer}.\n`)
    expect(result.events.filter(event => event === 'dropdb')).toHaveLength(1)
    expect(result.events).not.toContain('bootstrap')
    expect(result.events.at(-1)).toBe('dropdb')
  })

  it('continues after successful copy without diagnostics and preserves later failure cleanup', () => {
    const result = runHarness(0, 0, 0)
    expect(result.status).toBe(73)
    expect(result.stderr).toBe('')
    expect(result.events.filter(event => event === 'bootstrap')).toHaveLength(1)
    expect(result.events.filter(event => event === 'dropdb')).toHaveLength(1)
    expect(result.events.at(-1)).toBe('dropdb')
  })

  it('preserves the original failure and cleanup when diagnostics cannot write', () => {
    const result = runHarness(0, 0, 3, true)
    expect(result.status).toBe(3)
    expect(result.stderr).toBe('')
    expect(result.events).not.toContain('bootstrap')
    expect(result.events.at(-1)).toBe('dropdb')
  })
})
