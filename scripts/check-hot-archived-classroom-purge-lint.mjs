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
let parsedJson = true
const lintOutput = lint.stdout.trim()
const normalizedOutputLines = lintOutput
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
const normalizedDiagnosticLines = lint.stderr
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
const expectedDiagnosticLines = [
  'Connecting to local database...',
  'Linting schema: public',
]
const cleanResultLine = 'No schema errors found'

function hasExpectedDiagnosticPrefix(lines) {
  return lines.length >= expectedDiagnosticLines.length
    && lines.slice(0, expectedDiagnosticLines.length)
      .every((line, index) => line === expectedDiagnosticLines[index])
}

function isKnownUpdateNotice(lines) {
  return lines.length === 0 || (
    lines.length === 2
    && /^A new version of Supabase CLI is available: v\d+\.\d+\.\d+ \(currently installed v\d+\.\d+\.\d+\)$/.test(lines[0])
    && lines[1] === 'We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli'
  )
}

const knownJsonDiagnosticOutput = hasExpectedDiagnosticPrefix(normalizedDiagnosticLines)
  && isKnownUpdateNotice(normalizedDiagnosticLines.slice(expectedDiagnosticLines.length))
const knownStdoutCleanResult = normalizedOutputLines.length === 1
  && normalizedOutputLines[0] === cleanResultLine
  && knownJsonDiagnosticOutput
const cleanResultDiagnosticIndex = expectedDiagnosticLines.length
const knownStderrCleanResult = normalizedOutputLines.length === 0
  && normalizedDiagnosticLines.length > cleanResultDiagnosticIndex
  && hasExpectedDiagnosticPrefix(normalizedDiagnosticLines)
  && normalizedDiagnosticLines[cleanResultDiagnosticIndex] === cleanResultLine
  && isKnownUpdateNotice(normalizedDiagnosticLines.slice(cleanResultDiagnosticIndex + 1))

try {
  report = JSON.parse(lintOutput)
} catch {
  parsedJson = false
  if (!knownStdoutCleanResult && !knownStderrCleanResult) {
    process.stderr.write(lint.stderr)
    console.error('Supabase database lint did not return valid JSON.')
    process.exit(2)
  }

  report = { results: [] }
}

if (parsedJson && !knownJsonDiagnosticOutput) {
  process.stderr.write(lint.stderr)
  console.error('Supabase database lint did not return valid JSON.')
  process.exit(2)
}

if (
  report === null
  || typeof report !== 'object'
  || Array.isArray(report)
  || !Array.isArray(report.results)
  || !report.results.every((result) => (
    result !== null
    && typeof result === 'object'
    && !Array.isArray(result)
    && typeof result.function === 'string'
    && Array.isArray(result.issues)
    && result.issues.every((issue) => (
      issue !== null
      && typeof issue === 'object'
      && !Array.isArray(issue)
      && typeof issue.level === 'string'
      && typeof issue.message === 'string'
      && (
        issue.statement === undefined
        || issue.statement === null
        || (
          typeof issue.statement === 'object'
          && !Array.isArray(issue.statement)
          && (
            issue.statement.lineNumber === undefined
            || issue.statement.lineNumber === null
            || Number.isInteger(issue.statement.lineNumber)
            || (typeof issue.statement.lineNumber === 'string' && /^\d+$/.test(issue.statement.lineNumber))
          )
        )
      )
    ))
  ))
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
