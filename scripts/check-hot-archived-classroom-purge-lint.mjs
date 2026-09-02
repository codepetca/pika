#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const migrationPaths = [
  'supabase/migrations/118_hot_archived_classroom_purge_managed_ownership.sql',
  'supabase/migrations/123_hot_classroom_individual_student_purge.sql',
]
const migration = migrationPaths.map((path) => readFileSync(path, 'utf8')).join('\n')
const migrationFunctions = new Set(
  Array.from(
    migration.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi),
    (match) => `public.${match[1]}`,
  ),
)

if (migrationFunctions.size === 0) {
  console.error(`No PostgreSQL functions found in ${migrationPaths.join(', ')}.`)
  process.exit(2)
}

const lint = spawnSync('pnpm', [
  'exec',
  'supabase',
  'db',
  'lint',
  '--local',
  '--schema',
  'public',
  '--level',
  'warning',
  '--fail-on',
  'none',
  '--output-format',
  'json',
], { encoding: 'utf8' })

if (lint.status !== 0) {
  process.stderr.write(lint.stderr || lint.stdout)
  process.exit(lint.status ?? 2)
}

let report
const lintOutput = lint.stdout.trim()
try {
  report = JSON.parse(lintOutput)
} catch {
  const normalizedLines = lintOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const cleanTextLines = [
    'Connecting to local database...',
    'Linting schema: public',
    'No schema errors found',
  ]
  const cleanTextResult = normalizedLines.length === cleanTextLines.length
    && normalizedLines.every((line, index) => line === cleanTextLines[index])

  if (!cleanTextResult) {
    process.stderr.write(lint.stderr)
    console.error('Supabase database lint did not return valid JSON.')
    process.exit(2)
  }

  report = { results: [] }
}

if (
  report === null
  || typeof report !== 'object'
  || Array.isArray(report)
  || !Array.isArray(report.results)
) {
  console.error('Supabase database lint did not return valid JSON.')
  process.exit(2)
}

const findings = report.results.filter(
  (result) => migrationFunctions.has(result.function) && result.issues?.length > 0,
)

if (findings.length > 0) {
  console.error('Managed purge PostgreSQL function lint failed:')
  for (const finding of findings) {
    for (const issue of finding.issues) {
      const line = issue.statement?.lineNumber ? ` line ${issue.statement.lineNumber}` : ''
      console.error(`- ${finding.function}${line}: ${issue.level}: ${issue.message}`)
    }
  }
  process.exit(1)
}

console.log(`Managed purge PostgreSQL function lint passed (${migrationFunctions.size} functions).`)
