/** Self-contained browser callback: Playwright serializes this function alone. */
export function observeContextualTestFont(element: Element, { state, position }: { state: 'preview' | 'read-only' | 'editing' | 'empty'; position: boolean }) {
  const navs = document.querySelectorAll('nav[aria-label="Pattern Lab sections"]')
  const nav = navs.length === 1 ? navs[0] : null
  const navStyle = nav ? getComputedStyle(nav) : null
  const inset = navStyle ? Number.parseFloat(navStyle.top) : NaN
  const navHeight = nav?.getBoundingClientRect().height ?? 0
  const validNav = !!nav && navStyle?.position === 'sticky' && Number.isFinite(inset) && navHeight > 0
  if (validNav && position) {
    const original = element.getBoundingClientRect()
    window.scrollTo({ top: window.scrollY + original.top - (inset + navHeight + 8), behavior: 'instant' })
  }
  const box = element.getBoundingClientRect(), editor = element.querySelector('.tiptap.ProseMirror')
  const heading = element.querySelector('h2')
  const clip = { x: Math.ceil(box.left), y: Math.ceil(box.top),
    width: Math.floor(box.right) - Math.ceil(box.left),
    height: Math.floor(Math.min(box.bottom, window.innerHeight)) - Math.ceil(box.top) }
  const contained = (rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }, bounds: { left: number; top: number; right: number; bottom: number }) =>
    rect.width > 0 && rect.height > 0 && rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom
  const clipBounds = { left: clip.x, top: clip.y, right: clip.x + clip.width, bottom: clip.y + clip.height }
  const visible = (node: Element) => {
    for (let current: Element | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (style.display === 'none' || style.visibility !== 'visible' || Number.parseFloat(style.opacity) === 0 || style.contentVisibility === 'hidden') return false
    }
    return true
  }
  const inside = (node: Element) => visible(node) && contained(node.getBoundingClientRect(), clipBounds)
  const blocks = editor ? Array.from(editor.querySelectorAll(':scope > *')).slice(0, 2) : []
  let placeholder = state !== 'empty'
  if (state === 'empty' && editor && blocks.length === 1) {
    const paragraph = blocks[0], expected = paragraph.getAttribute('data-placeholder')
    const canonical = paragraph.matches('p.is-empty[data-placeholder]') && paragraph.childNodes.length === 1
      && paragraph.firstElementChild?.matches('br.ProseMirror-trailingBreak') && editor.textContent?.trim() === ''
    if (canonical && expected === 'Write your response here...' && visible(paragraph)) {
      const pseudo = getComputedStyle(paragraph, '::before')
      let content: unknown
      try { content = JSON.parse(pseudo.content) } catch { content = undefined }
      const fontSize = Number.parseFloat(pseudo.fontSize)
      // The stylesheet intentionally gives ::before height:0. Require the
      // canonical paragraph's real line box below, rather than deriving glyph
      // geometry from that generated box or weakening the content fit check.
      placeholder = content === expected && pseudo.display !== 'none' && pseudo.visibility === 'visible'
        && Number.parseFloat(pseudo.opacity) > 0 && pseudo.color !== 'transparent'
        && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(pseudo.color)
        && !/\/\s*0(?:\.0+)?\s*\)$/.test(pseudo.color)
        && Number.isFinite(fontSize) && fontSize > 0
    }
  }
  const checks = {
    navigation: validNav && box.top >= nav!.getBoundingClientRect().bottom + 1,
    viewport: clip.x >= 0 && box.right <= window.innerWidth && clip.y >= 0 && clip.width > 0 && clip.height > 0,
    heading: !!heading && inside(heading),
    content: !!editor && (state === 'empty' ? inside(editor) && blocks.length === 1 && inside(blocks[0]) : blocks.length > 0 && blocks.every(inside)),
    placeholder,
  }
  return { dark: document.documentElement.classList.contains('dark'), ready: document.fonts.status === 'loaded',
    fits: element.scrollWidth <= element.clientWidth + 1 && box.width <= window.innerWidth + 1
      && !!editor && editor.scrollWidth <= editor.clientWidth + 1,
    positioned: Object.values(checks).every(Boolean), clip,
    editable: editor?.getAttribute('contenteditable') ?? null, text: editor?.textContent?.trim(),
    preview: !!element.querySelector('[data-history-preview-mode="focused"], [data-history-preview-mode="locked"]'),
    pinnedPreview: !!element.querySelector('[data-history-preview-mode="locked"]')
      && element.querySelector('[role="slider"][aria-label="Complete save history"]')?.getAttribute('aria-valuenow') === '3', checks }
}
