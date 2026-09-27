'use client'

import { useEffect, useState } from 'react'

/** Browsers expose no native maximize state; compare outer window and available screen bounds. */
export function useWindowMaximized() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const update = () => {
      const { availWidth, availHeight } = window.screen
      setIsMaximized(
        availWidth > 0 && availHeight > 0
        && window.outerWidth === availWidth
        && window.outerHeight === availHeight
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
