'use client'

import { WorldOverlayProvider } from './WorldOverlayProvider'
import { WorldOverlay } from './WorldOverlay'

export function WorldOverlayMount({
  classroomId,
  enabled,
}: {
  classroomId: string | undefined
  enabled: boolean
}) {
  if (!enabled || !classroomId) return null
  return (
    <WorldOverlayProvider classroomId={classroomId}>
      <WorldOverlay />
    </WorldOverlayProvider>
  )
}

