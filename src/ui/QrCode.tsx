'use client'

import QRCode from 'react-qr-code'
import { cn } from './utils'

export interface QrCodeProps {
  value: string
  label: string
  className?: string
}

export function QrCode({ value, label, className }: QrCodeProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('inline-flex overflow-hidden rounded-card border border-border p-4', className)}
    >
      <QRCode
        value={value}
        size={256}
        bgColor="var(--color-qr-background)"
        fgColor="var(--color-qr-foreground)"
        className="h-auto w-full max-w-64"
        aria-hidden="true"
      />
    </div>
  )
}
