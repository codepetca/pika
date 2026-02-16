'use client'

import { useEffect, useState } from 'react'

export function useDelayedBusy(busy: boolean, delayMs = 180) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!busy) {
      setVisible(false)
      return
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [busy, delayMs])

  return visible
}
