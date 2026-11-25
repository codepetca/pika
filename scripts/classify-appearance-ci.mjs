import { execFileSync } from 'node:child_process'
import { appendFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shaPattern = /^[0-9a-f]{40}$/
const ownedPaths = new Set(['src/styles/tokens.css', 'src/app/join/page.tsx'])
const utf8 = new TextDecoder('utf-8', { fatal: true })
const skipped = () => ({ selection: 'skip', calendar: false, join: false })

function git(cwd, args) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function line(cwd, args) {
  const result = utf8.decode(git(cwd, args))
  if (!result.endsWith('\n') || result.slice(0, -1).includes('\n')) throw new Error('Expected one Git line')
  return result.slice(0, -1)
}

function commit(cwd, sha) {
  if (!shaPattern.test(sha) || line(cwd, ['cat-file', '-t', sha]) !== 'commit') throw new Error('Invalid commit')
  const raw = utf8.decode(git(cwd, ['cat-file', 'commit', sha]))
  const header = raw.split('\n\n', 1)[0].split('\n')
  const trees = header.filter(value => value.startsWith('tree '))
  const parents = header.filter(value => value.startsWith('parent ')).map(value => value.slice(7))
  if (trees.length !== 1 || !shaPattern.test(trees[0].slice(5)) || parents.some(value => !shaPattern.test(value))) {
    throw new Error('Invalid commit headers')
  }
  return { tree: trees[0].slice(5), parents }
}

function diff(cwd, from, to) {
  // NUL-delimited raw output preserves tabs, newlines and non-UTF-8 path bytes.
  // Compare exact owned ASCII paths only; never decode an unknown path lossily.
  const raw = git(cwd, ['diff', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--no-textconv', from, to, '--'])
  const records = []
  let offset = 0
  const take = () => {
    const end = raw.indexOf(0, offset)
    if (end === -1) throw new Error('Unterminated diff evidence')
    const value = raw.subarray(offset, end)
    offset = end + 1
    return value
  }
  const seen = new Set()
  while (offset < raw.length) {
    const header = take()
    if (!header.every(byte => byte < 128)) throw new Error('Invalid raw diff')
    const match = /^:(100644|100755) (100644|100755) ([0-9a-f]{40}) ([0-9a-f]{40}) M$/.exec(header.toString('ascii'))
    const pathBytes = take()
    const path = [...ownedPaths].find(value => pathBytes.equals(Buffer.from(value)))
    if (!match || match[1] !== match[2] || !path || seen.has(path) || match[3] === match[4]) {
      throw new Error('Non-owned or non-regular modification')
    }
    seen.add(path)
    records.push({ path, before: match[3], after: match[4] })
  }
  if (!records.length) throw new Error('Empty diff')
  return records
}

function calendarConsumers(cwd, sha) {
  const raw = git(cwd, ['grep', '--full-name', '-l', '-z', '-e', 'calendar-announcement', sha, '--', 'src', 'tailwind.config.ts'])
  const expected = ['src/styles/tokens.css', 'src/components/LessonDayCell.tsx', 'tailwind.config.ts']
    .map(path => `${sha}:${path}`).sort()
  const records = []
  let offset = 0
  while (offset < raw.length) {
    const end = raw.indexOf(0, offset)
    if (end === -1) return false
    const value = raw.subarray(offset, end)
    if (!value.every(byte => byte < 128)) return false
    records.push(value.toString('ascii'))
    offset = end + 1
  }
  return records.length === expected.length && records.sort().every((path, index) => path === expected[index])
}

/** Built-ins only. Eligibility policy lives in the workflow; all Git evidence is proved here. */
export function preflightAppearance({ env = process.env, cwd = process.cwd() } = {}) {
  try {
    const base = env.APPEARANCE_BASE
    const head = env.APPEARANCE_HEAD
    const tested = env.APPEARANCE_TESTED
    if (![base, head, tested].every(value => typeof value === 'string' && shaPattern.test(value))) return { candidate: false }
    const control = env.APPEARANCE_SWITCH
    if (control !== 'shadow' && control !== 'enabled' && control !== head) return { candidate: false }
    if (base === head || base === tested || head === tested ||
        line(cwd, ['rev-parse', '--is-shallow-repository']) !== 'false' ||
        line(cwd, ['rev-parse', '--verify', 'HEAD']) !== tested) return { candidate: false }
    commit(cwd, base)
    commit(cwd, head)
    const merge = commit(cwd, tested)
    if (merge.parents.length !== 2 || merge.parents[0] !== base || merge.parents[1] !== head) return { candidate: false }
    const ancestor = line(cwd, ['merge-base', '--all', base, head])
    if (!shaPattern.test(ancestor)) return { candidate: false }
    const proposed = diff(cwd, ancestor, head)
    const merged = diff(cwd, base, tested)
    if ([...proposed, ...merged].some(change => change.path === 'src/styles/tokens.css') &&
        (!calendarConsumers(cwd, base) || !calendarConsumers(cwd, tested))) return { candidate: false }
    // Ordered parents alone do not prove the checked-out tree is their actual merge.
    const tree = line(cwd, ['merge-tree', '--write-tree', '--no-messages', base, head])
    if (tree !== merge.tree) return { candidate: false }
    return { candidate: true, control, head, proposed, merged }
  } catch {
    // Missing objects, conflicts, malformed bytes, ambiguous merge bases and Git errors
    // all retain the existing CI path.
    return { candidate: false }
  }
}

function blobs(cwd, changes) {
  return changes.map(change => ({
    path: change.path,
    before: utf8.decode(git(cwd, ['cat-file', 'blob', change.before])),
    after: utf8.decode(git(cwd, ['cat-file', 'blob', change.after])),
  }))
}

export async function classifyAppearance(options = {}) {
  const proof = preflightAppearance(options)
  if (!proof.candidate) return skipped()
  try {
    const { assessAppearanceDiff } = await import('./appearance-ci-diff.mjs')
    const cwd = options.cwd ?? process.cwd()
    const proposed = assessAppearanceDiff(blobs(cwd, proof.proposed))
    const merged = assessAppearanceDiff(blobs(cwd, proof.merged))
    if (proposed.mode !== 'appearance' || merged.mode !== 'appearance') return skipped()
    const surfaces = new Set([...proposed.surfaces, ...merged.surfaces])
    return {
      selection: proof.control === 'shadow' ? 'shadow' : 'gate',
      calendar: surfaces.has('calendar'), join: surfaces.has('join'),
    }
  } catch {
    return skipped()
  }
}

function output(values) {
  const text = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('')
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text)
  process.stdout.write(text)
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'preflight') output({ candidate: preflightAppearance().candidate })
  else if (process.argv[2] === 'classify') output(await classifyAppearance())
  else { output({ candidate: false, ...skipped() }); process.exitCode = 1 }
}
