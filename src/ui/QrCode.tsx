'use client'

import QRCode from 'react-qr-code'
import { cn } from './utils'

export interface QrCodeProps {
  value: string
  label: string
  className?: string
  codeClassName?: string
}

export function QrCode({ value, label, className, codeClassName }: QrCodeProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex overflow-hidden rounded-card border border-border bg-qr-background p-4 text-qr-foreground',
        className,
      )}
    >
      <QRCode
        value={value}
        size={256}
        bgColor="transparent"
        fgColor="currentColor"
        className={cn('h-auto w-full max-w-64', codeClassName)}
        aria-hidden="true"
      />
    </div>
  )
}
