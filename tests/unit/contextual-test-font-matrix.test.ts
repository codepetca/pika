import { describe, expect, it } from 'vitest'
import { contextualTestFontShots, contextualTestFontShot, contextualTestFontEditingText, runContextualTestFontMatrix } from '../../e2e/helpers/contextual-test-font-matrix'

describe('fixed font matrix CPU contract (not visual evidence)', () => {
  it('defines 32 unique fixed references and honest authenticated teacher/editor provenance', () => {
    expect(contextualTestFontShots).toHaveLength(32)
    expect(new Set(contextualTestFontShots.map(shot => shot.label)).size).toBe(32)
    expect(contextualTestFontShots.filter(shot => shot.fontReference === 'shared-student-editor-reference')).toHaveLength(16)
    for (const shot of contextualTestFontShots) {
      expect(contextualTestFontShot(shot.label)).toBe(shot)
      expect(Object.isFrozen(shot)).toBe(true)
      if (shot.state === 'editing' || shot.state === 'empty') {
        expect(shot.referenceRole).toBe('student'); expect(shot.selector).toContain('student-image-upload')
      } else expect(shot.selector).toContain('history-preview')
    }
    expect(() => contextualTestFontShot('font-ownerTeacher-desktop-light-survey')).toThrow()
  })
  it('runs all 32 screenshots through the runtime in two actual authenticated actor scopes', async () => {
    const actors: string[] = [], captures: string[] = [], fills: string[] = [], keys: string[] = [], urls: string[] = [], themes: string[] = []
    let currentActor = '', currentUrl = '', viewport = { width: 0, height: 0 }, theme = ''
    let storedTheme = '', renderedTheme = '', previewOpen = false, reloads = 0
    const control = { async waitFor() {}, async click() {}, async fill(value: string) { fills.push(value) }, async press(value: string) { keys.push(value) } }
    const exitPreview = { async waitFor({ state }: { state: string }) { expect(previewOpen).toBe(state === 'visible') }, async click() { previewOpen = false } }
    const mount = () => { renderedTheme = storedTheme; previewOpen = true }
    const page = { async setViewportSize(value: typeof viewport) { viewport = value }, async emulateMedia(value: { colorScheme: string }) { theme = value.colorScheme },
      async evaluate(_fn: unknown, value: string) { themes.push(value); storedTheme = value }, async goto(value: string) {
        // A fragment-only navigation retains component state and does not
        // rerun the document's localStorage theme initializer.
        const before = new URL(currentUrl), after = new URL(value)
        const hashOnly = before.href !== after.href && before.origin === after.origin && before.pathname === after.pathname && before.search === after.search
        currentUrl = value; urls.push(value)
        if (!hashOnly) mount()
      },
      locator(selector: string) { expect(selector).toMatch(/^#(?:history-preview|student-image-upload)\[/); return { ...control, getByRole: () => exitPreview } } }
    const runtime = { plan: { appOrigin: 'http://localhost:3117' }, check() {},
      async navigate(p: typeof page, url: string, waitUntil: string) { expect(p).toBe(page); expect(waitUntil).toBe('load'); await p.goto(url) },
      async reload(p: typeof page) { expect(p).toBe(page); reloads++; mount() },
      async withActor(actor: string, action: (p: typeof page) => Promise<void>) { actors.push(actor); currentActor = actor; currentUrl = 'http://localhost:3117/classrooms'; await action(page) },
      async captureFont(label: string, p: typeof page) {
        expect(p).toBe(page); const shot = contextualTestFontShot(label)
        expect(shot.actor).toBe(currentActor); expect(shot.theme).toBe(theme)
        expect(renderedTheme).toBe(shot.theme)
        if (shot.state === 'preview' || shot.state === 'read-only') expect(previewOpen).toBe(shot.state === 'preview')
        expect(viewport.width).toBe(shot.view === 'desktop' ? 1440 : 390)
        expect(new URL(currentUrl).search).toBe(`?role=${shot.referenceRole}`); captures.push(label)
        // Empty evidence follows one real keyboard selection/deletion sequence,
        // not fill('')'s asynchronous DOM-only selection and not a retry loop.
        expect(keys).toHaveLength((captures.filter(value => value.endsWith('-empty')).length) * 2)
      } }
    await runContextualTestFontMatrix(runtime as never)
    expect(actors).toEqual(['ownerTeacher', 'memberStudent'])
    expect(captures).toEqual(contextualTestFontShots.map(shot => shot.label))
    expect(urls).toHaveLength(16); expect(themes).toHaveLength(8)
    expect(reloads).toBe(8)
    expect(fills).toEqual(Array.from({ length: 8 }, () => contextualTestFontEditingText))
    expect(keys).toEqual(Array.from({ length: 8 }, () => ['ControlOrMeta+a', 'Backspace']).flat())
    expect(urls.every(url => new URL(url).pathname === '/pattern-lab')).toBe(true)
  })
})
