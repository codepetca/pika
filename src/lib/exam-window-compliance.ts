/**
 * Pure exam-window compliance rules.
 *
 * The student Tests surface enforces that an in-progress exam occupies the
 * whole screen. The DOM reads stay in the feature component; the decision
 * itself lives here so it can be tested directly.
 */

export const EXAM_WINDOW_MIN_WIDTH_RATIO = 0.92
export const EXAM_WINDOW_MIN_HEIGHT_RATIO = 0.88

/**
 * Longest edge, in CSS pixels, still treated as a phone/tablet-sized viewport.
 */
export const EXAM_COMPACT_VIEWPORT_MAX_PX = 1024

export interface ExamWindowComplianceInput {
  /** The document is in browser fullscreen. */
  isFullscreen: boolean
  /** The browser has no usable Fullscreen API (for example iOS Safari). */
  isFullscreenApiSupported: boolean
  /** The device reports touch input (`maxTouchPoints` or a coarse pointer). */
  hasTouchInput: boolean
  innerWidth: number
  innerHeight: number
  widthRatio: number
  heightRatio: number
}

export function isCompactViewport(innerWidth: number, innerHeight: number): boolean {
  return Math.min(innerWidth, innerHeight) <= EXAM_COMPACT_VIEWPORT_MAX_PX
}

/**
 * Touch devices whose browser cannot enter fullscreen at all. Enforcing the
 * fullscreen requirement there would lock the student out of their own exam,
 * so window compliance is waived and away/visibility tracking carries the
 * proctoring signal instead.
 */
export function isMobileFullscreenFallback(input: {
  isFullscreenApiSupported: boolean
  hasTouchInput: boolean
  innerWidth: number
  innerHeight: number
}): boolean {
  if (input.isFullscreenApiSupported) return false
  return input.hasTouchInput && isCompactViewport(input.innerWidth, input.innerHeight)
}

/**
 * An on-screen keyboard shrinks the visual viewport height while leaving its
 * width alone. Without this exemption a student typing a written answer on a
 * touch device trips the "window must be maximized" lock on every keystroke
 * session.
 *
 * Deliberately narrow: the width must still satisfy the normal threshold, so a
 * side-by-side window cannot hide behind this rule, and it only applies to
 * compact touch viewports.
 */
export function isLikelyVirtualKeyboardViewport(input: {
  hasTouchInput: boolean
  innerWidth: number
  innerHeight: number
  widthRatio: number
  heightRatio: number
}): boolean {
  if (!input.hasTouchInput) return false
  if (!isCompactViewport(input.innerWidth, input.innerHeight)) return false
  return (
    input.widthRatio >= EXAM_WINDOW_MIN_WIDTH_RATIO &&
    input.heightRatio < EXAM_WINDOW_MIN_HEIGHT_RATIO
  )
}

export function resolveExamWindowCompliance(input: ExamWindowComplianceInput): boolean {
  if (input.isFullscreen) return true

  if (
    isMobileFullscreenFallback({
      isFullscreenApiSupported: input.isFullscreenApiSupported,
      hasTouchInput: input.hasTouchInput,
      innerWidth: input.innerWidth,
      innerHeight: input.innerHeight,
    })
  ) {
    return true
  }

  if (
    input.widthRatio >= EXAM_WINDOW_MIN_WIDTH_RATIO &&
    input.heightRatio >= EXAM_WINDOW_MIN_HEIGHT_RATIO
  ) {
    return true
  }

  return isLikelyVirtualKeyboardViewport({
    hasTouchInput: input.hasTouchInput,
    innerWidth: input.innerWidth,
    innerHeight: input.innerHeight,
    widthRatio: input.widthRatio,
    heightRatio: input.heightRatio,
  })
}
