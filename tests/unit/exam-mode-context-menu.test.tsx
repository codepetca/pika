import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenForExamContextMenus } from '@/lib/exam-mode-context-menu'

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

function setup() {
  const root = document.createElement('section')
  const text = document.createElement('p')
  text.textContent = 'Exam words to translate'
  root.append(text)
  document.body.append(root)
  const callbacks = { onContextMenu: vi.fn(), onCancel: vi.fn() }
  cleanups.push(listenForExamContextMenus(window, root, callbacks))
  return { root, text, callbacks }
}

function select(target: Element, start = 0, end = target.textContent!.length) {
  const range = target.ownerDocument.createRange()
  range.setStart(target.firstChild!, start)
  range.setEnd(target.firstChild!, end)
  const selection = target.ownerDocument.defaultView!.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function menu(target: Element) {
  return target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}

describe('exam selected-text context menus', () => {
  it('reports selected exam text as a boolean and leaves the native menu available', () => {
    const { text, callbacks } = setup()
    select(text)
    expect(menu(text)).toBe(true)
    expect(callbacks.onContextMenu).toHaveBeenCalledExactlyOnceWith(true)
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })

  it('reports blank, collapsed, and missing selections as ineligible', () => {
    const { text, callbacks } = setup()
    text.textContent = '   words'
    menu(text)
    select(text, 0, 0)
    menu(text)
    select(text, 0, 3)
    menu(text)
    expect(callbacks.onContextMenu.mock.calls).toEqual([[false], [false], [false]])
  })

  it('rejects outside menu targets even while exam text is selected', () => {
    const { text, callbacks } = setup()
    const outside = document.createElement('p')
    outside.textContent = 'Outside words'
    document.body.append(outside)
    select(text)
    menu(outside)
    expect(callbacks.onContextMenu).toHaveBeenLastCalledWith(false)
    select(outside)
    menu(text)
    expect(callbacks.onContextMenu).toHaveBeenLastCalledWith(false)
  })

  it('rejects a selection spanning exam and non-exam content', () => {
    const { text, callbacks } = setup()
    const outside = document.createElement('p')
    outside.textContent = 'Outside words'
    document.body.append(outside)
    const range = document.createRange()
    range.setStart(text.firstChild!, 0)
    range.setEnd(outside.firstChild!, 5)
    window.getSelection()!.addRange(range)
    menu(text)
    expect(callbacks.onContextMenu).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['textarea', 'input'])('supports selected %s ranges without exposing the value', tag => {
    const { root, callbacks } = setup()
    const field = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement
    field.value = '   chosen words'
    root.append(field)
    field.focus()
    field.setSelectionRange(3, 9)
    expect(menu(field)).toBe(true)
    expect(callbacks.onContextMenu).toHaveBeenLastCalledWith(true)
    field.setSelectionRange(0, 3)
    menu(field)
    expect(callbacks.onContextMenu).toHaveBeenLastCalledWith(false)
    field.setSelectionRange(3, 3)
    menu(field)
    expect(callbacks.onContextMenu).toHaveBeenLastCalledWith(false)
  })

  it('cancels intent on pointerdown and keydown, including Escape, without blocking events', () => {
    const { text, callbacks } = setup()
    select(text)
    menu(text)
    expect(text.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))).toBe(true)
    expect(text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))).toBe(true)
    expect(text.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))).toBe(true)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(3)
  })

  it('handles accessible nested frames and later loads within the exam root', () => {
    const { root, callbacks } = setup()
    const frame = document.createElement('iframe')
    root.append(frame)
    const nested = frame.contentDocument!.createElement('iframe')
    frame.contentDocument!.body.append(nested)
    frame.dispatchEvent(new Event('load'))
    const text = nested.contentDocument!.createElement('p')
    text.textContent = 'Reference words'
    nested.contentDocument!.body.append(text)
    select(text)
    expect(menu(text)).toBe(true)
    expect(callbacks.onContextMenu).toHaveBeenCalledExactlyOnceWith(true)
    text.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })

  it('observes existing frames but excludes frames outside the exam root', () => {
    const root = document.createElement('section')
    const frame = document.createElement('iframe')
    root.append(frame)
    const outside = document.createElement('iframe')
    document.body.append(root, outside)
    const callbacks = { onContextMenu: vi.fn(), onCancel: vi.fn() }
    cleanups.push(listenForExamContextMenus(window, root, callbacks))
    for (const candidate of [frame, outside]) {
      const text = candidate.contentDocument!.createElement('p')
      text.textContent = 'Reference words'
      candidate.contentDocument!.body.append(text)
      select(text)
      menu(text)
    }
    expect(callbacks.onContextMenu.mock.calls).toEqual([[true]])
  })

  it('attaches a nested frame loaded later and rejects a frame moved outside the exam root', () => {
    const { root, callbacks } = setup()
    const frame = document.createElement('iframe')
    root.append(frame)
    frame.dispatchEvent(new Event('load'))
    const nested = frame.contentDocument!.createElement('iframe')
    frame.contentDocument!.body.append(nested)
    nested.dispatchEvent(new Event('load'))
    const text = nested.contentDocument!.createElement('p')
    text.textContent = 'Nested words'
    nested.contentDocument!.body.append(text)
    select(text)
    menu(text)
    expect(callbacks.onContextMenu).toHaveBeenLastCalledWith(true)

    // Moving an iframe may detach its old event path entirely; neither path may authorize it.
    callbacks.onContextMenu.mockClear()
    document.body.append(frame)
    menu(text)
    expect(callbacks.onContextMenu.mock.calls.some(([eligible]) => eligible)).toBe(false)
  })

  it('ignores inaccessible frames and detaches listeners from a frame that navigates away', () => {
    const { root, text, callbacks } = setup()
    const frame = document.createElement('iframe')
    root.append(frame)
    frame.dispatchEvent(new Event('load'))
    const oldBody = frame.contentDocument!.body
    Object.defineProperty(frame, 'contentDocument', {
      get: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    frame.dispatchEvent(new Event('load'))
    menu(oldBody)
    expect(callbacks.onContextMenu).not.toHaveBeenCalled()
    select(text)
    menu(text)
    expect(callbacks.onContextMenu).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('removes parent, frame, and load listeners on cleanup', () => {
    const { root, text, callbacks } = setup()
    const frame = document.createElement('iframe')
    root.append(frame)
    frame.dispatchEvent(new Event('load'))
    cleanups.splice(0).forEach(cleanup => cleanup())
    menu(text)
    menu(frame.contentDocument!.body)
    text.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const later = document.createElement('iframe')
    root.append(later)
    later.dispatchEvent(new Event('load'))
    menu(later.contentDocument!.body)
    expect(callbacks.onContextMenu).not.toHaveBeenCalled()
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })
})
