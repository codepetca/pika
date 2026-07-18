#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_ENTRIES = 60
const DEFAULT_KEEP = Math.floor(DEFAULT_MAX_ENTRIES * 2 / 3)
const DEFAULT_SOURCE = '.ai/SESSION-LOG.md'
const DEFAULT_OUTPUT = '.ai/SESSION-LOG.md'
const DEFAULT_ARCHIVE = '.ai/JOURNAL-ARCHIVE.md'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = {
    check: false,
    keep: DEFAULT_KEEP,
    keepWasSet: false,
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    archive: DEFAULT_ARCHIVE,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--keep' && next) {
      args.keep = Number.parseInt(next, 10)
      args.keepWasSet = true
      index += 1
    } else if (arg === '--check') {
      args.check = true
    } else if (arg === '--source' && next) {
      args.source = next
      index += 1
    } else if (arg === '--output' && next) {
      args.output = next
      index += 1
    } else if (arg === '--archive' && next) {
      args.archive = next
      index += 1
    } else if (arg === '--no-archive') {
      args.archive = null
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (!Number.isInteger(args.keep) || args.keep < 1) {
    throw new Error('--keep must be a positive integer')
  }
  args.maxEntries = args.check && args.keepWasSet ? args.keep : DEFAULT_MAX_ENTRIES

  return args
}

function usage() {
  return [
    'Usage: node scripts/trim-session-log.mjs [--keep 40] [--source .ai/SESSION-LOG.md] [--output .ai/SESSION-LOG.md] [--archive .ai/JOURNAL-ARCHIVE.md | --no-archive]',
    '       node scripts/trim-session-log.mjs --check [--keep 60] [--source .ai/SESSION-LOG.md]',
    '',
    'Keeps the latest session entries, where each entry starts with a markdown "## " heading.',
    'Trimmed entries are appended to the archive file so history is preserved; pass --no-archive to discard them instead.',
    'Use --check to fail when dated entries are out of order or the source has more entries than the check cap.',
  ].join('\n')
}

function extractEntries(markdown) {
  const headingPattern = /^## .+$/gm
  const matches = [...markdown.matchAll(headingPattern)]

  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? markdown.length
    return markdown.slice(start, end).trim()
  })
}

function extractEntryDate(entry) {
  const match = /^## (\d{4})-(\d{2})-(\d{2})(?:\s|$)/.exec(entry)

  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const isoDate = parsed.toISOString().slice(0, 10)
  const headingDate = `${year}-${month}-${day}`

  return isoDate === headingDate ? headingDate : null
}

function assertDatedEntries(entries, source) {
  const invalidEntry = entries.find((entry) => extractEntryDate(entry) === null)

  if (invalidEntry) {
    const heading = invalidEntry.split('\n', 1)[0]
    throw new Error(
      `${source} entry headings must start with a valid ISO date (YYYY-MM-DD); found: ${heading}`,
    )
  }
}

function orderEntriesChronologically(entries) {
  const records = entries.map((entry, index) => ({
    date: extractEntryDate(entry),
    entry,
    index,
  }))
  const datedRecords = records
    .filter((record) => record.date !== null)
    .sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index)
  let datedIndex = 0

  // Same-day entries retain source order through the explicit index tie-breaker.
  return records.map((record) => record.date === null ? record.entry : datedRecords[datedIndex++].entry)
}

function entriesAreChronological(entries) {
  let previousDate = null

  for (const entry of entries) {
    const date = extractEntryDate(entry)

    if (date !== null && previousDate !== null && date < previousDate) {
      return false
    }
    if (date !== null) {
      previousDate = date
    }
  }

  return true
}

function buildSessionLog(entries) {
  const header = [
    '# Pika Session Log',
    '',
    'Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.',
    '',
    '**Rules:**',
    '- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.',
    '- Start each entry heading with a valid ISO date (`## YYYY-MM-DD ...`) so retention can identify the latest entries.',
    '- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.',
    '- Use `node scripts/trim-session-log.mjs --check` to verify the log is chronological and within the 60-entry cap.',
    '- Keep enough recent entries for weekly automations to inspect roughly the last week of work.',
    '- The trim step appends removed entries to `.ai/JOURNAL-ARCHIVE.md`, so trimming never loses history.',
    '- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.',
    '',
    '',
  ].join('\n')

  return `${header}${entries.join('\n\n')}\n`
}

function appendToArchive(archivePath, entries) {
  const archiveHeader = [
    '# Pika Project Journal',
    '',
    '**Rules:**',
    '- Append-only. Never delete entries.',
    '- `scripts/trim-session-log.mjs` appends entries trimmed from `.ai/SESSION-LOG.md` here.',
    '',
    '',
  ].join('\n')
  const existing = existsSync(archivePath) ? readFileSync(archivePath, 'utf8') : ''
  const archivedEntries = new Set(extractEntries(existing))
  const entriesToAppend = entries.filter((entry) => {
    if (archivedEntries.has(entry)) {
      return false
    }

    archivedEntries.add(entry)
    return true
  })

  if (entriesToAppend.length === 0) {
    return 0
  }

  const base = existing.trim().length > 0 ? `${existing.replace(/\n+$/, '')}\n\n` : archiveHeader

  writeFileSync(archivePath, `${base}${entriesToAppend.join('\n\n')}\n`)

  return entriesToAppend.length
}

function trimSessionLog({ keep, source, output, archive }) {
  const sourcePath = resolve(repoRoot, source)
  const outputPath = resolve(repoRoot, output)
  const markdown = readFileSync(sourcePath, 'utf8')
  const entries = extractEntries(markdown)

  if (entries.length === 0) {
    throw new Error(`No session entries found in ${source}`)
  }

  assertDatedEntries(entries, source)
  const orderedEntries = orderEntriesChronologically(entries)
  const retainedEntries = orderedEntries.slice(-keep)
  const removedEntries = orderedEntries.slice(0, orderedEntries.length - retainedEntries.length)

  let archivedEntries = 0
  if (archive && removedEntries.length > 0) {
    archivedEntries = appendToArchive(resolve(repoRoot, archive), removedEntries)
  }

  writeFileSync(outputPath, buildSessionLog(retainedEntries))

  return {
    source,
    output,
    archive,
    total: entries.length,
    retained: retainedEntries.length,
    archived: archivedEntries,
  }
}

function checkSessionLog({ maxEntries, source }) {
  const sourcePath = resolve(repoRoot, source)
  const markdown = readFileSync(sourcePath, 'utf8')
  const entries = extractEntries(markdown)

  if (entries.length === 0) {
    throw new Error(`No session entries found in ${source}`)
  }

  assertDatedEntries(entries, source)
  if (!entriesAreChronological(entries)) {
    throw new Error(
      `${source} dated entries are not in chronological order; run node scripts/trim-session-log.mjs to repair the order.`,
    )
  }

  if (entries.length > maxEntries) {
    throw new Error(
      `${source} has ${entries.length} entries; run node scripts/trim-session-log.mjs to compact to the latest ${DEFAULT_KEEP}.`,
    )
  }

  return {
    source,
    total: entries.length,
    maxEntries,
  }
}

try {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(usage())
    process.exit(0)
  }

  if (args.check) {
    const result = checkSessionLog(args)
    console.log(`${result.source} is within cap: ${result.total}/${result.maxEntries} entries`)
  } else {
    const result = trimSessionLog(args)
    const archiveNote = result.archived > 0 ? `; archived ${result.archived} to ${result.archive}` : ''
    console.log(
      `Trimmed ${result.output}: kept ${result.retained} of ${result.total} entries from ${result.source}${archiveNote}`,
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
