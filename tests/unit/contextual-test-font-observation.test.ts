// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeContextualTestFont } from '../../e2e/helpers/contextual-test-font-observation'

function fixture(empty = true) {
  document.body.innerHTML = '<nav aria-label="Pattern Lab sections"></nav><section><h2>Editor</h2><div class="tiptap ProseMirror" contenteditable="true"><p class="is-empty is-editor-empty" data-placeholder="Write your response here..."><br class="ProseMirror-trailingBreak"></p></div></section>'
  const gallery = document.querySelector('section')!, editor = gallery.querySelector('div')!, paragraph = editor.querySelector('p')!, nav = document.querySelector('nav')!
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} })
  const boxes = new Map<Element, ReturnType<typeof rect>>([
    [nav, rect(0, 16, 390, 64)], [gallery, rect(20, 88, 350, 600)],
    [gallery.querySelector('h2')!, rect(36, 104, 200, 24)], [editor, rect(36, 200, 318, 300)], [paragraph, rect(48, 216, 294, 24)],
  ])
  for (const [node] of boxes) node.getBoundingClientRect = () => boxes.get(node)! as DOMRect
  for (const node of [gallery, editor]) {
    Object.defineProperty(node, 'clientWidth', { configurable: true, value: boxes.get(node)!.width })
    Object.defineProperty(node, 'scrollWidth', { configurable: true, value: boxes.get(node)!.width })
  }
  if (!empty) { paragraph.textContent = 'Existing history'; paragraph.removeAttribute('data-placeholder'); paragraph.className = '' }
  const base = { display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible', position: 'static', top: 'auto', fontSize: '16px', color: 'rgb(100, 100, 100)', overflowX: 'visible', overflowY: 'visible' }
  const pseudo = { ...base, content: '"Write your response here..."', height: '0px' }
  const styles = new Map<Element, Record<string, string>>([[nav, { ...base, position: 'sticky', top: '16px' }], [paragraph, { ...base, position: 'relative' }]])
  vi.stubGlobal('getComputedStyle', (node: Element, pseudoElement?: string) => pseudoElement ? pseudo : styles.get(node) ?? base)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded' } })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  // Execute the serialized callback, as Playwright does: module closures cannot help it.
  const observe = new Function(`return (${observeContextualTestFont.toString()})`)() as typeof observeContextualTestFont
  return { gallery, editor, paragraph, nav, boxes, rect, pseudo, styles, base, observe: (state: Parameters<typeof observe>[1]['state'] = empty ? 'empty' : 'read-only', position = true) => observe(gallery, { state, position }) }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('serialized font observation CPU geometry contract (not visual evidence)', () => {
  function previewFixture(viewportClass = 'simple-editor-content') {
    const f = fixture(false), viewport = document.createElement('div'), second = document.createElement('p')
    viewport.className = viewportClass
    viewport.setAttribute('data-history-preview-mode', 'locked')
    f.editor.before(viewport); viewport.append(f.editor)
    f.paragraph.outerHTML = '<h1>Document heading</h1>'
    const first = f.editor.querySelector('h1')!
    second.textContent = 'Opening body'; f.editor.append(second)
    viewport.scrollTop = 100; viewport.scrollLeft = 12
    viewport.getBoundingClientRect = () => f.rect(36, 200, 318, 140) as DOMRect
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 318 }, clientHeight: { value: 140 },
      scrollWidth: { value: 330 }, scrollHeight: { value: 1000 },
    })
    f.editor.getBoundingClientRect = () => f.rect(36 - viewport.scrollLeft, 200 - viewport.scrollTop, 318, 1000) as DOMRect
    first.getBoundingClientRect = () => f.rect(48 - viewport.scrollLeft, 212 - viewport.scrollTop, 282, 30) as DOMRect
    second.getBoundingClientRect = () => f.rect(48 - viewport.scrollLeft, 260 - viewport.scrollTop, 282, 30) as DOMRect
    f.styles.set(viewport, { ...f.base, overflowX: 'auto', overflowY: 'auto' })
    const slider = document.createElement('div'); slider.setAttribute('role', 'slider'); slider.setAttribute('aria-label', 'Complete save history')
    slider.setAttribute('aria-valuenow', '3'); f.gallery.append(slider)
    const exit = document.createElement('button'); exit.textContent = 'Exit preview'; f.gallery.append(exit)
    return { ...f, viewport, first, second, slider, exit }
  }
  it.each(['simple-editor-content', 'simple-viewer-content'])('positions the owned pinned %s viewport before serialized observation without changing preview state', viewportClass => {
    const f = previewFixture(viewportClass)
    // Both opening blocks are in the outer screenshot but above the inner viewport.
    expect(f.observe('preview', false)).toMatchObject({ positioned: false, checks: { content: false } })
    expect(f.viewport.scrollTop).toBe(100)
    expect(f.observe('preview', true)).toMatchObject({ positioned: true, preview: true, pinnedPreview: true, checks: { content: true } })
    expect(f.viewport.scrollTop).toBe(0); expect(f.viewport.scrollLeft).toBe(0)
    expect(f.viewport.getAttribute('data-history-preview-mode')).toBe('locked')
    expect(f.slider.getAttribute('aria-valuenow')).toBe('3'); expect(f.exit.textContent).toBe('Exit preview')
    expect(f.first.textContent).toBe('Document heading'); expect(f.second.textContent).toBe('Opening body')
    vi.mocked(window.scrollTo).mockClear()
    const top = vi.spyOn(f.viewport, 'scrollTop', 'set'), left = vi.spyOn(f.viewport, 'scrollLeft', 'set')
    expect(f.observe('preview', false).positioned).toBe(true)
    expect(top).not.toHaveBeenCalled(); expect(left).not.toHaveBeenCalled(); expect(window.scrollTo).not.toHaveBeenCalled()
  })
  it('does not repair an unpinned viewport or a post-screenshot scroll drift', () => {
    const f = previewFixture()
    f.viewport.setAttribute('data-history-preview-mode', 'focused')
    expect(f.observe('preview', true)).toMatchObject({ positioned: false, pinnedPreview: false })
    expect(f.viewport.scrollTop).toBe(100)
    f.viewport.setAttribute('data-history-preview-mode', 'locked')
    expect(f.observe('preview', false).checks.content).toBe(false)
    expect(f.viewport.scrollTop).toBe(100)
  })
  it.each(['auto', 'scroll', 'hidden', 'clip', 'overlay'])('rejects opening content clipped by any nested overflow:%s ancestor', overflow => {
    const f = previewFixture(), frame = document.createElement('div')
    f.viewport.before(frame); frame.append(f.viewport)
    f.viewport.scrollTop = 0; f.viewport.scrollLeft = 0
    frame.getBoundingClientRect = () => f.rect(36, 200, 318, 75) as DOMRect
    Object.defineProperties(frame, { clientWidth: { value: 318 }, clientHeight: { value: 75 } })
    f.styles.set(frame, { ...f.base, overflowY: overflow })
    expect(f.observe('preview', false)).toMatchObject({ positioned: false, checks: { content: false } })
    // Do not scroll an arbitrary enclosing pane to make the sample pass.
    expect(f.observe('preview', true).checks.content).toBe(false); expect(frame.scrollTop).toBe(0)
  })
  it('uses each clipping axis and the client area inside borders and scrollbars', () => {
    const f = previewFixture()
    f.viewport.scrollTop = 0; f.viewport.scrollLeft = 0
    f.viewport.getBoundingClientRect = () => f.rect(36, 200, 318, 140) as DOMRect
    Object.defineProperty(f.viewport, 'clientWidth', { configurable: true, value: 280 })
    f.styles.set(f.viewport, { ...f.base, overflowX: 'hidden', overflowY: 'visible' })
    expect(f.observe('preview', false).checks.content).toBe(false)
    f.styles.set(f.viewport, { ...f.base, overflowX: 'visible', overflowY: 'hidden' })
    expect(f.observe('preview', false).checks.content).toBe(true)
  })
  it('does not reposition during post-capture verification and requires the locked third save', () => {
    const f = fixture(false)
    f.editor.setAttribute('data-history-preview-mode', 'focused')
    const slider = document.createElement('div'); slider.setAttribute('role', 'slider'); slider.setAttribute('aria-label', 'Complete save history')
    slider.setAttribute('aria-valuenow', '3'); f.gallery.append(slider)
    expect(f.observe('preview', false)).toMatchObject({ preview: true, pinnedPreview: false })
    f.editor.setAttribute('data-history-preview-mode', 'locked')
    expect(f.observe('preview', false)).toMatchObject({ preview: true, pinnedPreview: true })
    slider.setAttribute('aria-valuenow', '4')
    expect(f.observe('preview', false).pinnedPreview).toBe(false)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
  it('accepts canonical empty markup with a positive paragraph line box and a visible zero-height pseudo-element', () => {
    const f = fixture(); expect(f.observe()).toMatchObject({ positioned: true, fits: true, text: '', checks: { navigation: true, viewport: true, heading: true, content: true, placeholder: true } })
    expect(window.scrollTo).toHaveBeenCalledWith({ top: window.scrollY, behavior: 'instant' })
  })
  it.each(['none', 'hidden', 'transparent', 'wrong-content', 'no-attribute', 'no-break', 'tiny-font'])('rejects an absent or invisible placeholder: %s', reason => {
    const f = fixture()
    if (reason === 'none') f.pseudo.display = 'none'
    if (reason === 'hidden') f.pseudo.visibility = 'hidden'
    if (reason === 'transparent') f.pseudo.color = 'rgba(100, 100, 100, 0)'
    if (reason === 'wrong-content') f.pseudo.content = '"Other"'
    if (reason === 'no-attribute') f.paragraph.removeAttribute('data-placeholder')
    if (reason === 'no-break') f.paragraph.replaceChildren()
    if (reason === 'tiny-font') f.pseudo.fontSize = '0px'
    expect(f.observe()).toMatchObject({ positioned: false, checks: { placeholder: false } })
  })
  it('rejects a transient missing root and a whole editor clipped below the viewport', () => {
    const f = fixture(); f.editor.className = ''; expect(f.observe().checks.content).toBe(false)
    f.editor.className = 'tiptap ProseMirror'; f.boxes.set(f.editor, f.rect(36, 200, 318, 650))
    expect(f.observe()).toMatchObject({ positioned: false, checks: { content: false } })
    f.boxes.set(f.editor, f.rect(36, 200, 318, 0)); expect(f.observe().checks.content).toBe(false)
  })
  it('rejects a zero-height paragraph and paragraph content outside the clip', () => {
    const f = fixture(); f.boxes.set(f.paragraph, f.rect(48, 216, 294, 0))
    expect(f.observe()).toMatchObject({ positioned: false, checks: { content: false, placeholder: true } })
    f.boxes.set(f.paragraph, f.rect(48, 680, 294, 24))
    expect(f.observe().checks.content).toBe(false)
  })
  it('retains the first two positive-height history blocks without demanding the entire long history fit', () => {
    const f = fixture(false), second = document.createElement('p'); second.textContent = 'Body'; f.editor.append(second)
    second.getBoundingClientRect = () => f.rect(48, 250, 294, 24) as DOMRect
    f.boxes.set(f.editor, f.rect(36, 200, 318, 1000))
    expect(f.observe()).toMatchObject({ positioned: true, checks: { placeholder: true } })
    second.getBoundingClientRect = () => f.rect(48, 680, 294, 24) as DOMRect
    expect(f.observe().checks.content).toBe(false)
  })
  it('reports invalid or duplicate navigation without throwing', () => {
    const f = fixture(); f.styles.set(f.nav, { ...f.base, position: 'static' })
    expect(f.observe()).toMatchObject({ positioned: false, checks: { navigation: false } })
    f.nav.after(f.nav.cloneNode()); expect(f.observe().checks.navigation).toBe(false)
  })
  it('rejects navigation overlap, viewport overflow, hidden ancestors, and horizontal editor overflow', () => {
    const f = fixture(); f.boxes.set(f.gallery, f.rect(20, 70, 350, 600)); expect(f.observe().checks.navigation).toBe(false)
    f.boxes.set(f.gallery, f.rect(50, 88, 350, 600)); expect(f.observe().checks.viewport).toBe(false)
    f.boxes.set(f.gallery, f.rect(20, 88, 350, 600)); f.styles.set(f.editor, { ...f.base, opacity: '0' }); expect(f.observe().checks.placeholder).toBe(false)
    Object.defineProperty(f.editor, 'scrollWidth', { value: 400 }); expect(f.observe().fits).toBe(false)
  })
})
