#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_ENTRIES = 60
const DEFAULT_KEEP = Math.floor(DEFAULT_MAX_ENTRIES * 2 / 3)
const DEFAULT_SOURCE = '.ai/SESSION-LOG.md'
const DEFAULT_OUTPUT = '.ai/SESSION-LOG.md'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = {
    check: false,
    keep: DEFAULT_KEEP,
    maxEntries: DEFAULT_MAX_ENTRIES,
    keepWasSet: false,
    maxWasSet: false,
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--keep' && next) {
      args.keep = Number.parseInt(next, 10)
      args.keepWasSet = true
      index += 1
    } else if (arg === '--max' && next) {
      args.maxEntries = Number.parseInt(next, 10)
      args.maxWasSet = true
      index += 1
    } else if (arg === '--check') {
      args.check = true
    } else if (arg === '--source' && next) {
      args.source = next
      index += 1
    } else if (arg === '--output' && next) {
      args.output = next
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (!Number.isInteger(args.keep) || args.keep < 1) {
    throw new Error('--keep must be a positive integer')
  }
  if (!Number.isInteger(args.maxEntries) || args.maxEntries < 1) {
    throw new Error('--max must be a positive integer')
  }
  if (args.check && args.keepWasSet && !args.maxWasSet) {
    args.maxEntries = args.keep
  }

  return args
}

function usage() {
  return [
    'Usage: node scripts/trim-session-log.mjs [--keep 40] [--source .ai/SESSION-LOG.md] [--output .ai/SESSION-LOG.md]',
    '       node scripts/trim-session-log.mjs --check [--max 60] [--source .ai/SESSION-LOG.md]',
    '',
    'Keeps the latest session entries, where each entry starts with a markdown "## " heading.',
    'Use --check to fail when the source has more entries than the max window.',
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

function buildSessionLog(entries) {
  const header = [
    '# Pika Session Log',
    '',
    'Rolling recent session log for AI/human handoffs. Keep this file small; full historical session history lives in `.ai/JOURNAL-ARCHIVE.md`.',
    '',
    '**Rules:**',
    '- Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.',
    '- CI allows at most 60 entries; the trim step compacts to the latest 40 entries by default so there is headroom for future appends.',
    '- Use `node scripts/trim-session-log.mjs --check` to verify the log is within the 60-entry cap.',
    '- Keep enough recent entries for weekly automations to inspect roughly the last week of work.',
    '- Use `.ai/JOURNAL-ARCHIVE.md` only for historical investigation.',
    '',
    '',
  ].join('\n')

  return `${header}${entries.join('\n\n')}\n`
}

function trimSessionLog({ keep, source, output }) {
  const sourcePath = resolve(repoRoot, source)
  const outputPath = resolve(repoRoot, output)
  const markdown = readFileSync(sourcePath, 'utf8')
  const entries = extractEntries(markdown)

  if (entries.length === 0) {
    throw new Error(`No session entries found in ${source}`)
  }

  const retainedEntries = entries.slice(-keep)
  writeFileSync(outputPath, buildSessionLog(retainedEntries))

  return {
    source,
    output,
    total: entries.length,
    retained: retainedEntries.length,
  }
}

function checkSessionLog({ maxEntries, source }) {
  const sourcePath = resolve(repoRoot, source)
  const markdown = readFileSync(sourcePath, 'utf8')
  const entries = extractEntries(markdown)

  if (entries.length === 0) {
    throw new Error(`No session entries found in ${source}`)
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
    console.log(
      `Trimmed ${result.output}: kept ${result.retained} of ${result.total} entries from ${result.source}`,
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(1)
}
