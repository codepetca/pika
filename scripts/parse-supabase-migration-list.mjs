#!/usr/bin/env node

import process from 'node:process'

const versionPattern = /^\d+$/

function formatDrift(localVersion, databaseVersion) {
  if (localVersion === databaseVersion) return null
  return `  files=${localVersion || 'missing'} database=${databaseVersion || 'missing'}`
}

function validateVersions(localVersion, databaseVersion) {
  if (!localVersion && !databaseVersion) {
    throw new Error('Supabase migration row had no local or database version')
  }
  if (
    (localVersion && !versionPattern.test(localVersion)) ||
    (databaseVersion && !versionPattern.test(databaseVersion))
  ) {
    throw new Error('Supabase migration row contained an invalid version')
  }
}

export function parseSupabaseMigrationDrift(output) {
  const lines = output.split(/\r?\n/)
  const jsonLine = lines.find((line) => line.trimStart().startsWith('{"migrations":'))

  if (jsonLine) {
    const parsed = JSON.parse(jsonLine)
    if (!Array.isArray(parsed.migrations)) {
      throw new Error('Supabase migration JSON did not contain a migrations array')
    }
    if (parsed.migrations.length === 0) {
      throw new Error('Supabase migration JSON contained no migrations')
    }
    return parsed.migrations
      .map((migration) => {
        if (
          !migration ||
          typeof migration !== 'object' ||
          !Object.hasOwn(migration, 'local') ||
          !Object.hasOwn(migration, 'remote') ||
          typeof migration.local !== 'string' ||
          typeof migration.remote !== 'string'
        ) {
          throw new Error('Supabase migration JSON contained an invalid migration row')
        }
        const localVersion = migration.local.trim()
        const databaseVersion = migration.remote.trim()
        validateVersions(localVersion, databaseVersion)
        return formatDrift(localVersion, databaseVersion)
      })
      .filter(Boolean)
  }

  const candidateTableRows = lines
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|'))
    .filter((columns) => columns.length >= 2)
    .map(([localVersion, databaseVersion]) => [
      localVersion.replaceAll(/\s/g, ''),
      databaseVersion.replaceAll(/\s/g, ''),
    ])
    .filter(([localVersion, databaseVersion]) =>
      !/^(local|-+)$/.test(localVersion.toLowerCase()) &&
      !/^(remote|-+)$/.test(databaseVersion.toLowerCase())
    )

  if (candidateTableRows.length > 0) {
    return candidateTableRows
      .map(([localVersion, databaseVersion]) => {
        validateVersions(localVersion, databaseVersion)
        return formatDrift(localVersion, databaseVersion)
      })
      .filter(Boolean)
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
