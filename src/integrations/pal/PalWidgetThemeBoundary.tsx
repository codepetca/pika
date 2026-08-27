import type { ReactNode } from 'react'

import styles from './pal-widget-theme.module.css'

export function PalWidgetThemeBoundary({
  children,
  className,
  placement,
}: {
  children: ReactNode
  className?: string
  placement?: 'bottom-right'
}) {
  return (
    <div
      className={[
        styles.host,
        placement === 'bottom-right' ? styles.bottomRight : null,
        className,
      ].filter(Boolean).join(' ')}
      data-pika-pal-theme-contract="1"
      data-pika-pal-placement={placement}
    >
      {children}
    </div>
  )
}
