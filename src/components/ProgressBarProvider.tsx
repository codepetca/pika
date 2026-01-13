'use client'

import { AppProgressBar } from 'next-nprogress-bar'

export function ProgressBarProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AppProgressBar
        height="3px"
        color="var(--tt-brand-color-500)"
        options={{ showSpinner: false }}
        shallowRouting
      />
    </>
  )
}
