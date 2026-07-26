import type { ReactNode } from 'react'

import styles from './pal-widget-theme.module.css'

export function PalWidgetThemeBoundary({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={[styles.host, className].filter(Boolean).join(' ')}
      data-pika-pal-theme-contract="1"
    >
      {children}
    </div>
  )
}
