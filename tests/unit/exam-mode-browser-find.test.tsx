import { afterEach, describe, expect, it } from 'vitest'
import { blockExamBrowserFind } from '@/lib/exam-mode-browser-find'

afterEach(() => { document.body.replaceChildren() })

function find(target: Window, modifier: { ctrlKey?: boolean; metaKey?: boolean } = { ctrlKey: true }) {
  return target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'f', ...modifier, bubbles: true, cancelable: true,
  }))
}

describe('exam browser Find blocking', () => {
  it('blocks existing and nested frame windows and restores them on cleanup', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const nested = frame.contentDocument!.createElement('iframe')
    frame.contentDocument!.body.append(nested)
    const cleanup = blockExamBrowserFind(window)
    try {
      expect(find(window)).toBe(false)
      expect(find(frame.contentWindow!)).toBe(false)
      expect(find(nested.contentWindow!, { metaKey: true })).toBe(false)
    } finally { cleanup() }
    expect(find(window)).toBe(true)
    expect(find(frame.contentWindow!)).toBe(true)
    expect(find(nested.contentWindow!)).toBe(true)
  })

  it('attaches on later frame loads and removes its load listener on cleanup', () => {
    const cleanup = blockExamBrowserFind(window)
    const frame = document.createElement('iframe')
    document.body.append(frame)
    frame.dispatchEvent(new Event('load'))
    expect(find(frame.contentWindow!)).toBe(false)
    cleanup()
    const laterFrame = document.createElement('iframe')
    document.body.append(laterFrame)
    laterFrame.dispatchEvent(new Event('load'))
    expect(find(laterFrame.contentWindow!)).toBe(true)
  })

  it('ignores inaccessible browser frames without breaking the parent blocker', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    Object.defineProperty(frame, 'contentDocument', { get: () => { throw new DOMException('Blocked', 'SecurityError') } })
    const cleanup = blockExamBrowserFind(window)
    expect(find(window)).toBe(false)
    cleanup()
    expect(find(window)).toBe(true)
  })

  it('detaches the old frame document after an inaccessible navigation', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const oldWindow = frame.contentWindow!
    const cleanup = blockExamBrowserFind(window)
    try {
      expect(find(oldWindow)).toBe(false)
      Object.defineProperty(frame, 'contentDocument', {
        get: () => { throw new DOMException('Blocked', 'SecurityError') },
      })
      frame.dispatchEvent(new Event('load'))
      expect(find(oldWindow)).toBe(true)
      expect(find(window)).toBe(false)
    } finally { cleanup() }
  })
})
