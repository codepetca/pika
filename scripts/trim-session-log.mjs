#!/usr/bin/env node
/**
 * trim-session-log.mjs
 *
 * Trims .ai/SESSION-LOG.md to the last KEEP entries (default 10).
 * Run after appending a new entry at the end of each session.
 *
 * Usage:
 *   node scripts/trim-session-log.mjs [--keep=10] [--dry-run]
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOG = resolve(ROOT, '.ai/SESSION-LOG.md')

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const keep = parseInt(args.find(a => a.startsWith('--keep='))?.split('=')[1] ?? '10', 10)

let text
try {
  text = readFileSync(LOG, 'utf8')
} catch {
  console.error(`Session log not found: ${LOG}`)
  process.exit(1)
}

const lines = text.split('\n')

// Find the header boundary: first top-level --- (not indented)
const firstSepIdx = lines.findIndex(l => l === '---')
if (firstSepIdx === -1) {
  console.error('Malformed session log: no top-level --- separator found.')
  process.exit(1)
}

// Find all entry start lines (## 20XX), skipping code fences
let inFence = false
const entryStarts = []
for (let i = firstSepIdx + 1; i < lines.length; i++) {
  if (lines[i].startsWith('```')) { inFence = !inFence; continue }
  if (!inFence && /^## 20\d\d/.test(lines[i])) entryStarts.push(i)
}

if (entryStarts.length === 0) {
  console.log('No entries found — nothing to trim.')
  process.exit(0)
}

if (entryStarts.length <= keep) {
  console.log(`${entryStarts.length} entries — nothing to trim (limit: ${keep}).`)
  process.exit(0)
}

// Locate start of the first entry to keep: walk back past blank lines to include its --- separator
let sliceFrom = entryStarts[entryStarts.length - keep]
while (sliceFrom > firstSepIdx + 1 && lines[sliceFrom - 1] === '') sliceFrom--
if (sliceFrom > firstSepIdx + 1 && lines[sliceFrom - 1] === '---') sliceFrom--

const trimmed = entryStarts.length - keep
console.log(`Trimming ${trimmed} old ${trimmed === 1 ? 'entry' : 'entries'}, keeping ${keep}.`)

if (DRY_RUN) {
  console.log('[dry-run] No files written.')
  process.exit(0)
}

// Reconstruct: header (without its trailing ---) + the kept entries (which start with ---)
const header = lines.slice(0, firstSepIdx).join('\n').trimEnd()
const kept = lines.slice(sliceFrom).join('\n').trimEnd()
writeFileSync(LOG, `${header}\n\n${kept}\n`, 'utf8')
console.log('Done.')
