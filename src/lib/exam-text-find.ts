export interface ExamTextMatch {
  range: Range
  documentId: string | null
  label: string
}

/** Search rendered reading text only; never answer fields, controls, or frames. */
export function findExamTextMatches(root: HTMLElement, query: string): ExamTextMatch[] {
  const term = query.trim()
  if (!term) return []
  const pattern = term.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const matches: ExamTextMatch[] = []
  const regions = Array.from(root.querySelectorAll<HTMLElement>('[data-exam-search-text]'))
    .sort((a, b) => Number(Boolean(a.closest('[data-exam-find-document]'))) - Number(Boolean(b.closest('[data-exam-find-document]'))))
  for (const region of regions) {
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    const segments: { node: Text; start: number; end: number }[] = []
    let text = ''
    let previousBlock: Element | null = null
    let nextNode: Node | null
    while ((nextNode = walker.nextNode())) {
      if (nextNode instanceof HTMLBRElement) { text += '\n'; continue }
      if (nextNode.nodeType !== Node.TEXT_NODE) continue
      const node = nextNode as Text
      if (node.parentElement?.closest('input, textarea, select, script, style')) continue
      const block = node.parentElement?.closest('p, li, pre, blockquote, h1, h2, h3, h4, h5, h6') ?? region
      if (segments.length && block !== previousBlock) text += '\n'
      segments.push({ node, start: text.length, end: text.length + node.length })
      text += node.data
      previousBlock = block
    }
    const reference = region.closest<HTMLElement>('[data-exam-find-document]')
    for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
      const start = match.index!
      const end = start + match[0].length
      const first = segments.find((segment) => segment.start <= start && segment.end > start)
      const last = segments.find((segment) => segment.start < end && segment.end >= end)
      if (!first || !last) continue
      const range = document.createRange()
      range.setStart(first.node, start - first.start)
      range.setEnd(last.node, end - last.start)
      matches.push({
        range,
        documentId: reference?.dataset.examFindDocument ?? null,
        label: reference?.dataset.examFindLabel || 'Exam',
      })
    }
  }
  return matches
}

export function scrollExamTextMatchIntoView(match: ExamTextMatch) {
  const element = match.range.startContainer.parentElement
  if (!element) return
  const rect = match.range.getBoundingClientRect?.()
  let parent = element.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
      const container = parent.getBoundingClientRect()
      parent.scrollTop += (rect?.top ?? element.getBoundingClientRect().top) - container.top - parent.clientHeight / 2
      return
    }
    parent = parent.parentElement
  }
  element.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
}
