'use client'

import { useEffect, useState } from 'react'

/** Browser windows have no maximize event; use the teacher exam-preview size heuristic. */
export function useWindowMaximized() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const update = () => {
      const { availWidth, availHeight } = window.screen
      setIsMaximized(
        availWidth > 0 && availHeight > 0
        && window.innerWidth / availWidth >= 0.96
        && window.innerHeight / availHeight >= 0.9
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
