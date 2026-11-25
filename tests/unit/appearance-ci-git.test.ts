import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyAppearance, preflightAppearance } from '../../scripts/classify-appearance-ci.mjs'
import { cssPath, pagePath, css, page, copy } from '../fixtures/appearance-ci'

const changedPage = page.replace(copy, 'Type the code from your teacher.')
const changedCss = css.replace('#8d2b13', '#8d2b14')
const skip = { selection: 'skip', calendar: false, join: false }
type Change = { path: string | Buffer; text?: string; mode?: string; remove?: boolean }

let cwd: string
function git(args: string[], input?: string | Buffer) {
  return execFileSync('git', args, {
    cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Appearance fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Appearance fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' },
  }).trim()
}
function commit(parent: string | null, changes: Change[], parents?: string[]) {
  git(parent ? ['read-tree', parent] : ['read-tree', '--empty'])
  for (const change of changes) {
    const blob = change.remove ? '0'.repeat(40) : git(['hash-object', '-w', '--stdin'], change.text ?? '')
    const record = Buffer.concat([
      Buffer.from(`${change.remove ? '0' : change.mode ?? '100644'} ${blob}\t`),
      Buffer.isBuffer(change.path) ? change.path : Buffer.from(change.path), Buffer.from([0]),
    ])
    git(['update-index', '-z', '--index-info'], record)
  }
  return git(['commit-tree', git(['write-tree']), ...(parents ?? (parent ? [parent] : [])).flatMap(value => ['-p', value])], 'Appearance fixture\n')
}
function fixture(headChanges: Change[] = [{ path: pagePath, text: changedPage }], baseChanges: Change[] = [], inherited: Change[] = []) {
  const ancestor = commit(null, [{ path: cssPath, text: css }, { path: pagePath, text: page }, { path: 'README.md', text: 'Original\n' },
    { path: 'src/components/LessonDayCell.tsx', text: 'calendar-announcement' },
    { path: 'tailwind.config.ts', text: 'calendar-announcement' }, ...inherited])
  const base = commit(ancestor, baseChanges)
  const head = commit(ancestor, headChanges)
  const tree = git(['merge-tree', '--write-tree', '--no-messages', base, head])
  const tested = git(['commit-tree', tree, '-p', base, '-p', head], 'Tested merge\n')
  git(['update-ref', 'HEAD', tested])
  return { ancestor, env: { APPEARANCE_BASE: base, APPEARANCE_HEAD: head, APPEARANCE_TESTED: tested, APPEARANCE_SWITCH: 'enabled' }, tree }
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'pika-appearance-git-'))
  git(['init', '-q'])
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

describe('appearance CI trusted Git evidence', () => {
  it('classifies complete single and combined owned surfaces', async () => {
    const { env } = fixture([{ path: pagePath, text: changedPage }, { path: cssPath, text: changedCss }])
    expect(preflightAppearance({ cwd, env }).candidate).toBe(true)
    expect(await classifyAppearance({ cwd, env })).toEqual({ selection: 'gate', calendar: true, join: true })
  })

  it('supports shadow, enabled and exact-head controls and fails closed for all other values', async () => {
    const { env } = fixture()
    for (const control of ['shadow', 'enabled', env.APPEARANCE_HEAD]) {
      expect(await classifyAppearance({ cwd, env: { ...env, APPEARANCE_SWITCH: control } })).toEqual({ selection: control === 'shadow' ? 'shadow' : 'gate', calendar: false, join: true })
    }
    for (const control of [undefined, '', 'off', 'true', 'Enabled', env.APPEARANCE_BASE, `${env.APPEARANCE_HEAD}\n`, '$(touch unsafe)']) {
      const options = { cwd, env: { ...env, APPEARANCE_SWITCH: control } }
      expect(preflightAppearance(options).candidate).toBe(false)
      expect(await classifyAppearance(options)).toEqual(skip)
    }
  })

  it('rejects missing, abbreviated, tag, revision-expression and malformed commit evidence', async () => {
    const { env } = fixture()
    git(['tag', '-a', 'fixture-tag', '-m', 'Tag', env.APPEARANCE_HEAD])
    const tag = git(['rev-parse', 'fixture-tag'])
    for (const key of ['APPEARANCE_BASE', 'APPEARANCE_HEAD', 'APPEARANCE_TESTED']) {
      for (const value of [undefined, '', env[key as keyof typeof env].slice(0, 12), `${env.APPEARANCE_HEAD}^0`, `${env.APPEARANCE_HEAD}\n`, 'a'.repeat(40), tag, '--help']) {
        expect(preflightAppearance({ cwd, env: { ...env, [key]: value } }).candidate).toBe(false)
      }
    }
    expect(await classifyAppearance({ cwd, env: { ...env, APPEARANCE_HEAD: tag } })).toEqual(skip)
  })

  it('rejects stale checkout or event base and reversed, missing or extra merge parents', () => {
    const { env, tree, ancestor } = fixture()
    expect(preflightAppearance({ cwd, env: { ...env, APPEARANCE_BASE: ancestor } }).candidate).toBe(false)
    git(['update-ref', 'HEAD', env.APPEARANCE_HEAD])
    expect(preflightAppearance({ cwd, env }).candidate).toBe(false)
    for (const parents of [[env.APPEARANCE_HEAD, env.APPEARANCE_BASE], [env.APPEARANCE_BASE], [env.APPEARANCE_BASE, env.APPEARANCE_HEAD, ancestor]]) {
      const tested = git(['commit-tree', tree, ...parents.flatMap(value => ['-p', value])], 'Wrong parents\n')
      git(['update-ref', 'HEAD', tested])
      expect(preflightAppearance({ cwd, env: { ...env, APPEARANCE_TESTED: tested } }).candidate).toBe(false)
    }
  })

  it('rejects fabricated merge trees even when parents and owned path metadata look valid', () => {
    const { env } = fixture()
    const tested = commit(env.APPEARANCE_BASE, [{ path: pagePath, text: page.replace(copy, 'A fabricated merge.') }], [env.APPEARANCE_BASE, env.APPEARANCE_HEAD])
    git(['update-ref', 'HEAD', tested])
    expect(preflightAppearance({ cwd, env: { ...env, APPEARANCE_TESTED: tested } }).candidate).toBe(false)
  })

  it.each([
    { path: 'src/app/join/page.tsx\nREADME.md', text: 'alternate' },
    { path: 'src/app/join/page.tsx\t', text: 'alternate' },
    { path: Buffer.from([115, 114, 99, 47, 255]), text: 'invalid UTF-8' },
    { path: 'src/app/join/Page.tsx', text: 'case alternate' },
    { path: 'README.md', text: 'behavior' },
    { path: cssPath, text: css, mode: '100755' },
    { path: cssPath, text: '../../README.md', mode: '120000' },
    { path: cssPath, remove: true },
    { path: 'added.txt', text: 'added' },
  ])('rejects mixed changes or unsafe raw path/mode evidence ($path)', async extra => {
    const { env } = fixture([{ path: pagePath, text: changedPage }, extra])
    expect(preflightAppearance({ cwd, env }).candidate).toBe(false)
    expect(await classifyAppearance({ cwd, env })).toEqual(skip)
  })

  it('rejects a rename as deletion/addition without relying on similarity heuristics', () => {
    const { env } = fixture([{ path: pagePath, remove: true }, { path: 'src/app/join/renamed.tsx', text: changedPage }])
    expect(preflightAppearance({ cwd, env }).candidate).toBe(false)
  })

  it('rejects mixed PR paths already absorbed by base and absent from base-to-merge', () => {
    const extra = { path: 'README.md', text: 'Already absorbed behavior\n' }
    const { env } = fixture([{ path: pagePath, text: changedPage }, extra], [extra])
    expect(git(['diff', '--name-only', env.APPEARANCE_BASE, env.APPEARANCE_TESTED])).toBe(pagePath)
    expect(preflightAppearance({ cwd, env }).candidate).toBe(false)
  })

  it('requires the exact Calendar token consumer inventory in base and tested trees', async () => {
    for (const inherited of [
      [{ path: 'src/components/Other.tsx', text: 'calendar-announcement' }],
      [{ path: 'src/components/LessonDayCell.tsx', text: 'removed consumer' }],
      [{ path: 'tailwind.config.ts', text: 'removed mapping' }],
    ]) {
      const { env } = fixture([{ path: cssPath, text: changedCss }], [], inherited)
      expect(preflightAppearance({ cwd, env }).candidate).toBe(false)
      expect(await classifyAppearance({ cwd, env })).toEqual(skip)
    }
    const { env } = fixture(undefined, [], [{ path: 'src/components/Other.tsx', text: 'calendar-announcement' }])
    expect(await classifyAppearance({ cwd, env })).toEqual({ selection: 'gate', calendar: false, join: true })
  })

  it('rejects behavior already absorbed by base even when the tested delta is prose only', async () => {
    const behavior = page.replace('e.preventDefault()', 'e.stopPropagation()')
    const { env } = fixture([{ path: pagePath, text: behavior.replace(copy, 'A safe instruction.') }], [{ path: pagePath, text: behavior }])
    expect(preflightAppearance({ cwd, env }).candidate).toBe(true)
    expect(await classifyAppearance({ cwd, env })).toEqual(skip)
  })

  it('rejects empty PR/merge deltas and unavailable or shallow history', () => {
    const { env, ancestor } = fixture()
    expect(preflightAppearance({ cwd, env: { ...env, APPEARANCE_HEAD: ancestor } }).candidate).toBe(false)
    writeFileSync(join(cwd, '.git', 'shallow'), `${ancestor}\n`)
    expect(preflightAppearance({ cwd, env }).candidate).toBe(false)
  })

  it('ignores replacement refs when proving immutable commit objects', () => {
    const { env } = fixture()
    const replacement = commit(env.APPEARANCE_HEAD, [{ path: 'README.md', text: 'Not the head' }])
    git(['replace', env.APPEARANCE_HEAD, replacement])
    expect(preflightAppearance({ cwd, env }).candidate).toBe(true)
  })

  it('runs standalone preflight without loading any project dependencies and writes native outputs', () => {
    const { env } = fixture()
    const script = join(cwd, 'trusted-classifier.mjs')
    const output = join(cwd, 'outputs')
    copyFileSync(resolve('scripts/classify-appearance-ci.mjs'), script)
    const result = execFileSync(process.execPath, [script, 'preflight'], { cwd, encoding: 'utf8', env: { ...process.env, ...env, GITHUB_OUTPUT: output } })
    expect(result).toBe('candidate=true\n')
    expect(readFileSync(output, 'utf8')).toBe('candidate=true\n')
    // No adjacent classifier module exists: classify must retain the current path.
    expect(execFileSync(process.execPath, [script, 'classify'], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })).toBe('selection=skip\ncalendar=false\njoin=false\n')
  })
})
