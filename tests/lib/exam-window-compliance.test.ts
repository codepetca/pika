import { describe, expect, it } from 'vitest'
import {
  EXAM_WINDOW_MIN_HEIGHT_RATIO,
  EXAM_WINDOW_MIN_WIDTH_RATIO,
  isCompactViewport,
  isLikelyVirtualKeyboardViewport,
  isMobileFullscreenFallback,
  resolveExamWindowCompliance,
} from '@/lib/exam-window-compliance'

const desktop = {
  isFullscreen: false,
  isFullscreenApiSupported: true,
  hasTouchInput: false,
  innerWidth: 1440,
  innerHeight: 900,
  widthRatio: 1,
  heightRatio: 1,
}

describe('isCompactViewport', () => {
  it('treats phone and tablet viewports as compact', () => {
    expect(isCompactViewport(390, 844)).toBe(true)
    expect(isCompactViewport(844, 390)).toBe(true)
    expect(isCompactViewport(1024, 1366)).toBe(true)
  })

  it('does not treat a full desktop viewport as compact', () => {
    expect(isCompactViewport(1920, 1080)).toBe(false)
  })
})

describe('isMobileFullscreenFallback', () => {
  it('waives enforcement for touch devices with no Fullscreen API', () => {
    expect(isMobileFullscreenFallback({
      isFullscreenApiSupported: false,
      hasTouchInput: true,
      innerWidth: 390,
      innerHeight: 844,
    })).toBe(true)
  })

  it('does not waive enforcement when the browser can enter fullscreen', () => {
    expect(isMobileFullscreenFallback({
      isFullscreenApiSupported: true,
      hasTouchInput: true,
      innerWidth: 390,
      innerHeight: 844,
    })).toBe(false)
  })

  it('does not waive enforcement for a non-touch browser without the API', () => {
    expect(isMobileFullscreenFallback({
      isFullscreenApiSupported: false,
      hasTouchInput: false,
      innerWidth: 1440,
      innerHeight: 900,
    })).toBe(false)
  })
})

describe('isLikelyVirtualKeyboardViewport', () => {
  const keyboardOpen = {
    hasTouchInput: true,
    innerWidth: 390,
    innerHeight: 430,
    widthRatio: 1,
    heightRatio: 0.51,
  }

  it('recognises a height-only shrink on a compact touch viewport', () => {
    expect(isLikelyVirtualKeyboardViewport(keyboardOpen)).toBe(true)
  })

  it('ignores a shrink that also narrows the window', () => {
    expect(isLikelyVirtualKeyboardViewport({
      ...keyboardOpen,
      widthRatio: 0.5,
    })).toBe(false)
  })

  it('ignores a compliant height', () => {
    expect(isLikelyVirtualKeyboardViewport({
      ...keyboardOpen,
      heightRatio: 1,
    })).toBe(false)
  })

  it('does not apply to non-touch devices', () => {
    expect(isLikelyVirtualKeyboardViewport({
      ...keyboardOpen,
      hasTouchInput: false,
    })).toBe(false)
  })

  it('does not apply to a large touch screen', () => {
    expect(isLikelyVirtualKeyboardViewport({
      ...keyboardOpen,
      innerWidth: 1920,
      innerHeight: 1080,
    })).toBe(false)
  })
})

describe('resolveExamWindowCompliance', () => {
  it('accepts a maximized desktop window', () => {
    expect(resolveExamWindowCompliance(desktop)).toBe(true)
  })

  it('accepts any fullscreen document', () => {
    expect(resolveExamWindowCompliance({
      ...desktop,
      isFullscreen: true,
      widthRatio: 0.2,
      heightRatio: 0.2,
    })).toBe(true)
  })

  it('rejects an unmaximized desktop window', () => {
    expect(resolveExamWindowCompliance({
      ...desktop,
      widthRatio: 0.6,
      heightRatio: 0.6,
    })).toBe(false)
  })

  it('rejects a desktop window that is only slightly under the threshold', () => {
    expect(resolveExamWindowCompliance({
      ...desktop,
      widthRatio: EXAM_WINDOW_MIN_WIDTH_RATIO - 0.01,
      heightRatio: EXAM_WINDOW_MIN_HEIGHT_RATIO - 0.01,
    })).toBe(false)
  })

  it('keeps a touch device usable while its on-screen keyboard is open', () => {
    expect(resolveExamWindowCompliance({
      isFullscreen: false,
      // Android Chrome supports the Fullscreen API, so the mobile fallback
      // does not apply and the keyboard would otherwise trip the lock.
      isFullscreenApiSupported: true,
      hasTouchInput: true,
      innerWidth: 390,
      innerHeight: 430,
      widthRatio: 1,
      heightRatio: 0.51,
    })).toBe(true)
  })

  it('still rejects a narrowed window on a touch device', () => {
    expect(resolveExamWindowCompliance({
      isFullscreen: false,
      isFullscreenApiSupported: true,
      hasTouchInput: true,
      innerWidth: 390,
      innerHeight: 430,
      widthRatio: 0.5,
      heightRatio: 0.51,
    })).toBe(false)
  })
})
