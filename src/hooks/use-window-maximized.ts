'use client'

import { useEffect, useState } from 'react'

// Allow for small platform window-border differences without counting near-full windows.
const WINDOW_BORDER_TOLERANCE = 8

/** Browsers expose no native maximize state; compare outer window and available screen bounds. */
export function useWindowMaximized() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const update = () => {
      const { availWidth, availHeight } = window.screen
      setIsMaximized(
        availWidth > 0 && availHeight > 0
        && Math.abs(window.outerWidth - availWidth) <= WINDOW_BORDER_TOLERANCE
        && Math.abs(window.outerHeight - availHeight) <= WINDOW_BORDER_TOLERANCE
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('focus', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('focus', update)
    }
  }, [])

  return isMaximized
}
