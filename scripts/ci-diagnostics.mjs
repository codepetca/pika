#!/usr/bin/env node
// Small, failure-only evidence. Full logs remain in the Actions job log.
import { appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIAGNOSTIC_MAX_BYTES = 256 * 1024
export const DIAGNOSTIC_MAX_FILES = 8
const FILE_MAX_BYTES = 64 * 1024
const MANIFEST_RESERVE_BYTES = 8192

function regularBytes(path, maxBytes) {
  let fd
  try {
    if (!lstatSync(path).isFile()) return null
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) return null
    // Bound the read even if the file grows after fstat.
    const buffer = Buffer.alloc(maxBytes + 1)
    // readFileSync would consume an unbounded concurrently growing file.
    return readBounded(fd, buffer)
  } catch { return null } finally { if (fd !== undefined) closeSync(fd) }
}
function readBounded(fd, buffer) {
  let size = 0
  while (size < buffer.length) {
    const count = readSync(fd, buffer, size, buffer.length - size, null)
    if (count === 0) return buffer.subarray(0, size)
    size += count
  }
  return null
}
function directory(path) { try { return lstatSync(path).isDirectory() } catch { return false } }

export function collectCiDiagnostics(root = process.cwd()) {
  const destination = join(root, 'ci-failure-diagnostics')
  // Exclusive creation refuses stale output and linked destinations.
  mkdirSync(destination, { mode: 0o700 })
  let bytes = 0, files = 0, omitted = 0, visited = 0
  function add(path, name) {
    if (files >= DIAGNOSTIC_MAX_FILES - 1) { omitted++; return }
    const data = regularBytes(path, Math.min(FILE_MAX_BYTES, DIAGNOSTIC_MAX_BYTES - MANIFEST_RESERVE_BYTES - bytes))
    if (data === null) { omitted++; return }
    writeFileSync(join(destination, name), data, { flag: 'wx', mode: 0o600 })
    files++; bytes += data.length
  }
  // Never follow links, walk HTML reports, or upload trace/video/auth directories.
  const results = join(root, 'test-results')
  function visit(folder, depth) {
    if (!directory(folder)) return
    // A bounded traversal avoids huge result trees consuming the diagnostics step.
    const handle = opendirSync(folder)
    try {
      let entry
      while ((entry = handle.readSync()) !== null) {
        if (++visited > 256) { omitted++; return }
        if (entry.isDirectory() && depth < 2) visit(join(folder, entry.name), depth + 1)
        else if (entry.name === 'error-context.md') add(join(folder, entry.name), `error-context-${String(files + 1).padStart(3, '0')}.md`)
      }
    } finally { handle.closeSync() }
  }
  visit(results, 0)
  const coverage = join(root, 'coverage')
  if (directory(coverage)) for (const name of ['coverage-summary.json', 'coverage-final.json']) add(join(coverage, name), name)
  const manifest = JSON.stringify({ version: 1, files, bytes, omitted, maxBytes: DIAGNOSTIC_MAX_BYTES, maxFiles: DIAGNOSTIC_MAX_FILES,
    note: 'Only bounded regular failure-context and coverage files; oversized or unavailable evidence omitted. Full command output is in the job log.' }) + '\n'
  if (Buffer.byteLength(manifest) > MANIFEST_RESERVE_BYTES) throw new Error('Diagnostic manifest exceeds reserve.')
  writeFileSync(join(destination, 'manifest.json'), manifest, { flag: 'wx', mode: 0o600 })
  return { files: files + 1, bytes: bytes + Buffer.byteLength(manifest), omitted }
}

export function summarizeProofTimings(temp) {
  const lines = ['### Sanitized Test proof timings', '', '| Profile | Mode | Outcome | Milliseconds |', '| --- | --- | --- | ---: |']
  const folder = join(temp, 'pika-proof-timings')
  if (directory(folder)) for (const profile of ['test-owner-detail', 'test-owner-list']) for (const mode of ['normal', 'after-fixture', 'before-capture']) {
    const bytes = regularBytes(join(folder, `${profile}-${mode}.json`), 16 * 1024)
    if (bytes === null) continue
    try {
      const value = JSON.parse(bytes.toString('utf8'))
      if (value.version !== 1 || value.profile !== profile || value.mode !== mode || !/^[a-f0-9]{40}$/.test(value.reviewedSha)
        || !['passed', 'failed'].includes(value.outcome) || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0) continue
      lines.push(`| ${profile} | ${mode} | ${value.outcome} | ${Math.round(value.durationMs)} |`)
    } catch { /* Missing/malformed optional evidence never changes proof results. */ }
  }
  lines.push('', 'Missing or invalid receipts are omitted. Exact proof results remain in the job log.', '')
  return lines.join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Use collect or proof-summary.')
    if (process.argv[2] === 'collect') console.log(JSON.stringify(collectCiDiagnostics()))
    else if (process.argv[2] === 'proof-summary') {
      if (!process.env.RUNNER_TEMP || !process.env.GITHUB_STEP_SUMMARY) throw new Error('Missing summary paths.')
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summarizeProofTimings(process.env.RUNNER_TEMP))
    } else throw new Error('Use collect or proof-summary.')
  } catch (error) { console.error(`CI diagnostics unavailable: ${error.message}`); process.exitCode = 1 }
}
