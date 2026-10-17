import { describe, expect, it, vi } from 'vitest'
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
    let storedTheme = '', renderedTheme = '', previewOpen = false, pinned = false, selected = 3, reloads = 0
    const historyKeys: string[] = []
    const control = { async waitFor() {}, async click() {}, async fill(value: string) { fills.push(value) }, async press(value: string) { keys.push(value) } }
    const exitPreview = { async waitFor({ state }: { state: string }) { expect(previewOpen).toBe(state === 'visible') }, async click() { previewOpen = false } }
    const mount = () => { renderedTheme = storedTheme; previewOpen = true; pinned = false; selected = 3 }
    const slider = { async press(key: string, options: { timeout: number }) {
      expect(options.timeout).toBeGreaterThan(0); expect(options.timeout).toBeLessThanOrEqual(30000)
      historyKeys.push(key); selected = key === 'Home' ? 1 : selected + 1; pinned = true; previewOpen = true
    }, async getAttribute(name: string) { expect(name).toBe('aria-valuenow'); return String(selected) } }
    const page = { async setViewportSize(value: typeof viewport) { viewport = value }, async emulateMedia(value: { colorScheme: string }) { theme = value.colorScheme },
      async evaluate(_fn: unknown, value: string) { themes.push(value); storedTheme = value }, async goto(value: string) {
        // A fragment-only navigation retains component state and does not
        // rerun the document's localStorage theme initializer.
        const before = new URL(currentUrl), after = new URL(value)
        const hashOnly = before.href !== after.href && before.origin === after.origin && before.pathname === after.pathname && before.search === after.search
        currentUrl = value; urls.push(value)
        if (!hashOnly) mount()
      },
      locator(selector: string) { expect(selector).toMatch(/^#(?:history-preview|student-image-upload)\[/); return { ...control,
        getByRole(role: string, options: { name: string; exact: boolean }) {
          expect(options.exact).toBe(true)
          expect(options.name).toBe(role === 'slider' ? 'Complete save history' : 'Exit preview')
          return role === 'slider' ? slider : exitPreview
        },
        locator(value: string) { expect(value).toBe('[data-history-preview-mode="locked"]'); return { async waitFor() { expect(pinned).toBe(true) } } },
      } } }
    const runtime = { plan: { appOrigin: 'http://localhost:3117', limits: { operationMs: 30000 } }, deadline: Date.now() + 2700000, check() {},
      async navigate(p: typeof page, url: string, waitUntil: string) { expect(p).toBe(page); expect(waitUntil).toBe('load'); await p.goto(url) },
      async reload(p: typeof page) { expect(p).toBe(page); reloads++; mount() },
      async withActor(actor: string, action: (p: typeof page) => Promise<void>) { actors.push(actor); currentActor = actor; currentUrl = 'http://localhost:3117/classrooms'; await action(page) },
      async captureFont(label: string, p: typeof page) {
        expect(p).toBe(page); const shot = contextualTestFontShot(label)
        // Positioning/screenshot may move the graph away from the pointer.
        // Real UiGallery dismisses focused previews on mouseleave, not locked ones.
        if (!pinned) previewOpen = false
        expect(shot.actor).toBe(currentActor); expect(shot.theme).toBe(theme)
        expect(renderedTheme).toBe(shot.theme)
        if (shot.state === 'preview' || shot.state === 'read-only') expect(previewOpen).toBe(shot.state === 'preview')
        if (shot.state === 'preview') { expect(pinned).toBe(true); expect(selected).toBe(3) }
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
    expect(historyKeys).toEqual(Array.from({ length: 8 }, () => ['Home', 'ArrowRight', 'ArrowRight']).flat())
    expect(urls.every(url => new URL(url).pathname === '/pattern-lab')).toBe(true)
  })
  it.each(['deadline', 'selection'] as const)('fails a %s check before capture without repeating selection or renewing its deadline', async failure => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const started = Date.now(), timeouts: number[] = []
      const slider = { press: vi.fn(async (_key: string, options: { timeout: number }) => {
        timeouts.push(options.timeout)
        if (failure === 'deadline') vi.setSystemTime(Date.now() + 3)
      }), getAttribute: async () => '4' }
      const history = { getByRole: () => slider, locator: () => ({ waitFor: async () => {} }) }
      const page = { setViewportSize: async () => {}, emulateMedia: async () => {}, evaluate: async () => {}, locator: () => history }
      const captureFont = vi.fn()
      const runtime = { plan: { appOrigin: 'http://localhost:3117', limits: { operationMs: 30000 } }, deadline: started + 5, check() {},
        navigate: async () => {}, reload: async () => {}, captureFont,
        async withActor(_actor: string, action: (p: typeof page) => Promise<void>) { await action(page) } }
      await expect(runContextualTestFontMatrix(runtime as never)).rejects.toThrow()
      expect(captureFont).not.toHaveBeenCalled()
      expect(slider.press.mock.calls.map(([key]) => key)).toEqual(failure === 'deadline' ? ['Home', 'ArrowRight'] : ['Home', 'ArrowRight', 'ArrowRight'])
      expect(timeouts).toEqual(failure === 'deadline' ? [5, 2] : [5, 5, 5])
    } finally { vi.useRealTimers() }
  })
})
