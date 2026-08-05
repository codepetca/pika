#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const migrationPath = 'supabase/migrations/119_hot_archived_classroom_purge_managed_ownership.sql'
const migration = readFileSync(migrationPath, 'utf8')
const migrationFunctions = new Set(
  Array.from(
    migration.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(/gi),
    (match) => `public.${match[1]}`,
  ),
)

if (migrationFunctions.size === 0) {
  console.error(`No PostgreSQL functions found in ${migrationPath}.`)
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
try {
  report = JSON.parse(lint.stdout.trim())
} catch {
  process.stderr.write(lint.stderr)
  console.error('Supabase database lint did not return valid JSON.')
  process.exit(2)
}

const findings = (report.results || []).filter(
  (result) => migrationFunctions.has(result.function) && result.issues?.length > 0,
)

if (findings.length > 0) {
  console.error('Migration 119 PostgreSQL function lint failed:')
  for (const finding of findings) {
    for (const issue of finding.issues) {
      const line = issue.statement?.lineNumber ? ` line ${issue.statement.lineNumber}` : ''
      console.error(`- ${finding.function}${line}: ${issue.level}: ${issue.message}`)
    }
  }
  process.exit(1)
}

console.log(`Migration 119 PostgreSQL function lint passed (${migrationFunctions.size} functions).`)
