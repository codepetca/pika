import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { assessAppearanceDiff } from './appearance-ci-pilot-diff.mjs'

const tokens = 'src/styles/tokens.css'
const join = 'src/app/join/page.tsx'
const galleryTest = 'tests/ui/UiGallery.test.tsx'
const contrastTest = 'tests/unit/semantic-token-contrast.test.ts'
const originalCopy = 'Enter the join code your teacher gave you.'
const fixtures = {
  first: {
    copy: 'Enter the classroom code from your teacher.',
    colors: ['#812b19', '#ffe2d6', '#ffd6c6', '#ffc6ad', '#532c23', '#66392a'],
  },
  second: {
    copy: 'Use the join code your teacher shared to open your classroom.',
    colors: ['#902f18', '#ffdfd0', '#ffd3c1', '#ffccb7', '#502921', '#63362d'],
  },
}
const surfaceChecks = {
  calendar: {
    unit: [contrastTest, galleryTest, 'tests/components/LessonDayCell.test.tsx'],
    browser: ['e2e/calendar-appearance-pilot.ui-pattern-lab.spec.ts'],
  },
  join: {
    unit: [],
    browser: ['e2e/join-copy-appearance-pilot.ui-pattern-lab.spec.ts', 'e2e/join-code-controls.ui-pattern-lab.spec.ts'],
  },
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const original = new Map([tokens, join, galleryTest].map((path) => [path, readFileSync(path, 'utf8')]))
const changedPaths = () => git('diff', '--name-only', '--no-renames', '-z', 'HEAD', '--').split('\0').filter(Boolean)
const calendarReferences = git('grep', '-l', 'calendar-announcement', 'HEAD', '--', 'src', 'tailwind.config.ts')
  .trim().split('\n').sort()
assert.deepEqual(calendarReferences, [tokens, 'src/components/LessonDayCell.tsx', 'tailwind.config.ts']
  .map(path => `HEAD:${path}`).sort(), 'Recheck the Calendar surface if its known token references change')

function replaceOnce(path, before, after) {
  const source = original.get(path)
  assert.equal(source.split(before).length, 2, `Unexpected baseline in ${path}`)
  writeFileSync(path, source.replace(before, after))
}

function writeColors(values) {
  let count = 0
  const css = original.get(tokens).replace(
    /^(  --color-calendar-announcement(?:-bg|-hover)?: )#[a-f0-9]{6}(;)$/gim,
    (_, property, end) => `${property}${values[count++]}${end}`,
  )
  assert.equal(count, values.length, 'Unexpected Calendar palette baseline')
  writeFileSync(tokens, css)
}

function expectScope(description, mode, surfaces = []) {
  const changes = changedPaths().map((path) => ({
    path,
    before: original.get(path) ?? null,
    after: original.has(path) ? readFileSync(path, 'utf8') : null,
  }))
  const selected = assessAppearanceDiff(changes)
  assert.deepEqual(selected, { mode, surfaces }, description)
  console.log(`${description}: ${mode}${surfaces.length ? ` (${surfaces.join(', ')})` : ''}`)
  return selected.surfaces
}

function runTrial(label, changes) {
  assert.deepEqual(changedPaths(), [], 'Start the appearance pilot with clean tracked files')
  try {
    changes()
  } finally {
    // The GitHub job and local pilot use their own isolated checkouts.
    for (const path of changedPaths()) {
      assert(original.has(path), `Unexpected trial path: ${path}`)
      writeFileSync(path, original.get(path))
    }
    assert.deepEqual(changedPaths(), [], `Restore the checkout after ${label}`)
  }
}

function runFixture(name, { copy, colors }) {
  runTrial(name, () => {
    writeColors(colors)
    expectScope(`${name} Calendar palette only`, 'appearance', ['calendar'])
    writeFileSync(tokens, original.get(tokens))
    replaceOnce(join, originalCopy, copy)
    expectScope(`${name} /join copy only`, 'appearance', ['join'])
    writeColors(colors)
    const surfaces = expectScope(`${name} two surfaces`, 'appearance', ['calendar', 'join'])
    const units = surfaces.flatMap(surface => surfaceChecks[surface].unit)
    const browser = surfaces.flatMap(surface => surfaceChecks[surface].browser)

    if (units.length) execFileSync('pnpm', ['exec', 'vitest', 'run', '--maxWorkers=1', ...units], { stdio: 'inherit' })
    execFileSync('pnpm', ['exec', 'playwright', 'test', ...browser,
      '--project=pattern-lab-desktop-light', '--project=pattern-lab-desktop-dark',
      '--project=pattern-lab-mobile-light', '--project=pattern-lab-mobile-dark',
      `--output=test-results/appearance-${name}`,
    ], {
      env: {
        ...process.env,
        PIKA_APPEARANCE_JOIN_COPY: copy,
        PIKA_APPEARANCE_CALENDAR_COLORS: JSON.stringify({ light: colors.slice(0, 3), dark: colors.slice(3) }),
      },
      stdio: 'inherit',
    })
  })
}

function verifyFallbacks() {
  runTrial('join handler', () => {
    replaceOnce(join, originalCopy, fixtures.first.copy)
    const copyEdit = readFileSync(join, 'utf8')
    const handlerEdit = copyEdit.replace('const trimmed = code.trim()', 'const trimmed = code.toLowerCase().trim()')
    assert.notEqual(handlerEdit, copyEdit)
    writeFileSync(join, handlerEdit)
    expectScope('Copy plus submit behavior', 'broad')
  })
  runTrial('control label', () => {
    replaceOnce(join, 'label="Join code"', 'label="Classroom code"')
    expectScope('Accessible control label', 'broad')
  })
  runTrial('mixed test change', () => {
    writeColors(fixtures.first.colors)
    writeFileSync(galleryTest, `${original.get(galleryTest)}\nvoid true\n`)
    expectScope('Palette plus executable test change', 'broad')
  })
  runTrial('unreadable palette', () => {
    writeColors([fixtures.first.colors[1], ...fixtures.first.colors.slice(1)])
    expectScope('Unreadable palette has an appearance-only diff', 'appearance', ['calendar'])
    const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--maxWorkers=1', contrastTest], { encoding: 'utf8' })
    assert.equal(result.status, 1, result.stderr || result.stdout)
    assert.match(result.stderr + result.stdout, /light: --color-calendar-announcement on --color-calendar-announcement-bg/)
    console.log('Semantic contrast check rejected the deliberately unreadable palette.')
  })
}

const trial = process.argv[2]
if (trial === 'fallbacks') verifyFallbacks()
else {
  assert(Object.hasOwn(fixtures, trial), 'Choose first, second, or fallbacks')
  runFixture(trial, fixtures[trial])
}
