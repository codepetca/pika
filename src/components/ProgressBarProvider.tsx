'use client'

import { useState, useEffect } from 'react'
import { AppProgressBar } from 'next-nprogress-bar'

export function ProgressBarProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <>
      {children}
      {mounted && (
        <AppProgressBar
          height="3px"
          color="var(--tt-brand-color-500)"
          options={{ showSpinner: false }}
          shallowRouting
        />
      )}
    </>
  )
}
