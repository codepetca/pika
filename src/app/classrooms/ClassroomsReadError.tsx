'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { IconButton, PageState } from '@/ui'

/** Feature-owned recovery for a failed required server read. */
export function ClassroomsReadError({ compact = false, onRetry }: { compact?: boolean; onRetry?: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const retrying = useRef(false)

  useEffect(() => {
    if (!pending) retrying.current = false
  }, [pending])

  function retry() {
    if (pending || retrying.current) return
    retrying.current = true
    onRetry?.()
    startTransition(() => {
      router.refresh()
    })
  }

  return <ClassroomsReadRecoveryState compact={compact} pending={pending} onRetry={retry} />
}

/** The production recovery composition, also rendered with deterministic Pattern Lab fixtures. */
export function ClassroomsReadRecoveryState({ compact = false, pending = false, onRetry }: {
  compact?: boolean
  pending?: boolean
  onRetry: () => void
}) {
  return (
    <PageState
      kind="error"
      compact={compact}
      headingLevel={compact ? 'h2' : 'h1'}
      title="Could not load classrooms"
      description="Your classrooms could not be retrieved. Your work has not been changed."
      action={<IconButton icon={RotateCw} label="Try loading classrooms again" variant="secondary" loading={pending} onClick={onRetry} />}
    />
  )
}
