#!/usr/bin/env node

import process from 'node:process'

const versionPattern = /^\d+$/

function formatDrift(localVersion, databaseVersion) {
  if (localVersion === databaseVersion) return null
  if (!versionPattern.test(localVersion) && !versionPattern.test(databaseVersion)) return null
  return `  files=${localVersion || 'missing'} database=${databaseVersion || 'missing'}`
}

export function parseSupabaseMigrationDrift(output) {
  const lines = output.split(/\r?\n/)
  const jsonLine = lines.find((line) => line.trimStart().startsWith('{"migrations":'))

  if (jsonLine) {
    const parsed = JSON.parse(jsonLine)
    if (!Array.isArray(parsed.migrations)) {
      throw new Error('Supabase migration JSON did not contain a migrations array')
    }
    return parsed.migrations
      .map((migration) =>
        formatDrift(String(migration.local ?? '').trim(), String(migration.remote ?? '').trim())
      )
      .filter(Boolean)
  }

  const tableRows = lines
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|'))
    .filter((columns) => columns.length >= 2)
    .map(([localVersion, databaseVersion]) =>
      formatDrift(localVersion.replaceAll(/\s/g, ''), databaseVersion.replaceAll(/\s/g, ''))
    )
    .filter(Boolean)

  if (tableRows.length > 0 || lines.some((line) => /^\s*\d+\s*\|/.test(line))) {
    return tableRows
  }

  throw new Error('Unrecognized Supabase migration-list output')
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) input += chunk
  try {
    process.stdout.write(`${parseSupabaseMigrationDrift(input).join('\n')}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
