'use client'

import { useOverlayMessage } from './AppMessage'

interface RefreshingIndicatorProps {
  label?: string
  className?: string
}

export function RefreshingIndicator({
  label = 'Refreshing',
  className = '',
}: RefreshingIndicatorProps) {
  void className
  useOverlayMessage(true, label, { tone: 'loading', delayMs: 0 })
  return null
}
