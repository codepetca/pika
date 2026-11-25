import { describe, expect, it } from 'vitest'
import { assessAppearanceDiff } from '../../scripts/appearance-ci-diff.mjs'
import { cssPath, pagePath as joinPath, css, page, copy } from '../fixtures/appearance-ci'

const edit = (path: string, before: string, after: string) => ({ path, before, after })
const color = edit(cssPath, css, css.replace('#8d2b13', '#8d2b14'))
const helper = edit(joinPath, page, page.replace(copy, 'Type the code from your teacher.'))
const broad = { mode: 'broad', surfaces: [] }

describe('appearance CI complete-diff eligibility', () => {
  it('accepts the two exact repository surfaces separately and together in stable order', () => {
    expect(assessAppearanceDiff([color])).toEqual({ mode: 'appearance', surfaces: ['calendar'] })
    expect(assessAppearanceDiff([helper])).toEqual({ mode: 'appearance', surfaces: ['join'] })
    expect(assessAppearanceDiff([helper, color])).toEqual({ mode: 'appearance', surfaces: ['calendar', 'join'] })
    expect(assessAppearanceDiff([edit(cssPath, css, color.after.replace('#ffc0a6', '#ffc0a7'))]))
      .toEqual({ mode: 'appearance', surfaces: ['calendar'] })
  })

  it('rejects handler, accessible label, markup, expression and attribute edits', () => {
    for (const after of [
      helper.after.replace('e.preventDefault()', 'e.stopPropagation()'),
      helper.after.replace('label="Join code"', 'label="Class code"'),
      page.replace(copy, '<strong>Enter the code.</strong>'),
      page.replace(copy, '{code}'),
      page.replace(copy, '{"Enter the code."}'),
      helper.after.replace('className="text-text-muted mt-2"', 'className="text-text-muted mt-2" aria-live="polite"'),
    ]) expect(assessAppearanceDiff([edit(joinPath, page, after)])).toEqual(broad)
  })

  it('allows ordinary prose and punctuation, but rejects URLs, debug strings and entities', () => {
    for (const prose of ["Enter your teacher’s code (for example: ABC123), then choose ‘Join’!", 'Need help? Ask your teacher — they’ll have the code.', 'Saisissez le code de votre enseignant.']) {
      expect(assessAppearanceDiff([edit(joinPath, page, page.replace(copy, prose))])).toEqual({ mode: 'appearance', surfaces: ['join'] })
    }
    for (const unsafe of ['https://example.com', 'Visit example.ca.', 'www.example.org', 'javascript:alert(1)', 'console.log(123)', 'DEBUG: missing code', 'undefined', 'Use &quot;Join&quot;', 'Enter `code`.', 'Join {code}', 'Join <b>now</b>', '\u0000']) {
      expect(assessAppearanceDiff([edit(joinPath, page, page.replace(copy, unsafe))])).toEqual(broad)
      expect(assessAppearanceDiff([edit(joinPath, page.replace(copy, unsafe), helper.after)])).toEqual(broad)
    }
  })

  it('rejects selectors, geometry, shared or unrelated tokens, aliases and invalid colors', () => {
    for (const after of [
      color.after.replace(':root {', 'html {'),
      color.after.replace('--space-dialog: 1.25rem', '--space-dialog: 2rem'),
      color.after.replace('--color-primary: #1d4ed8', '--color-primary: #1d4ed9'),
      color.after.replace('--color-calendar-resource: #5c626e', '--color-calendar-resource: #5c626f'),
      css.replace('#8d2b13', 'var(--color-primary)'),
      css.replace('#8d2b13', '#12345'),
      css.replace('#8d2b13', '#123456 !important'),
      color.after.replace('--color-calendar-announcement: ', '--color-calendar-announcement:  '),
    ]) expect(assessAppearanceDiff([edit(cssPath, css, after)])).toEqual(broad)
  })

  it('rejects ambiguous declarations, scopes and helper paragraphs in either blob', () => {
    const ambiguous = [
      [cssPath, css + '\n:root {}', color.after + '\n:root {}'],
      [cssPath, css.replace(':root {', ':root { --color-calendar-announcement: #abc;'), color.after.replace(':root {', ':root { --color-calendar-announcement: #abc;')],
      [cssPath, css + '\np { --color-calendar-announcement: #abc; }', color.after + '\np { --color-calendar-announcement: #abc; }'],
      [joinPath, page.replace('</h1>', '</h1><p className="text-text-muted mt-2">Duplicate</p>'), helper.after.replace('</h1>', '</h1><p className="text-text-muted mt-2">Duplicate</p>')],
    ]
    for (const [path, before, after] of ambiguous) {
      expect(assessAppearanceDiff([edit(path, before, after)])).toEqual(broad)
      expect(assessAppearanceDiff([edit(path, path === cssPath ? css : page, after)])).toEqual(broad)
    }
  })

  it('rejects mixed tests, workflows, consumers and unknown paths', () => {
    for (const path of ['tests/unit/example.test.ts', '.github/workflows/appearance-ci-pilot.yml', 'tailwind.config.ts', 'src/components/LessonDayCell.tsx', 'unknown']) {
      expect(assessAppearanceDiff([color, edit(path, 'before', 'after')])).toEqual(broad)
    }
  })

  it('fails closed for empty, malformed, duplicate, new, deleted or unchanged evidence', () => {
    for (const changes of [[], null, {}, [null], [color, color], [{ ...color, before: null }],
      [{ ...helper, after: null }], [{ ...helper, status: 'M' }], [{ ...helper, after: 42 }],
      [edit(cssPath, css, css)], [edit(joinPath, page, '<p')], [{ path: cssPath }],
      [edit('toString', 'x', 'y')], [{ ...color, [Symbol('unknown')]: true }],
      [edit(cssPath, css, color.after + '\n{')], [edit(joinPath, page, page.replace(copy, ' '))]]) expect(assessAppearanceDiff(changes)).toEqual(broad)
  })
})
