'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  ACTIONBAR_BUTTON_SECONDARY_CLASSNAME,
  Button,
  PageState,
  cn,
} from '@/ui'

interface SyllabusPreviewProps {
  classroomTitle: string
  siteHref: string
}

export function SyllabusPreview({ classroomTitle, siteHref }: SyllabusPreviewProps) {
  const titleId = useId()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const iframeSrc = loadAttempt === 0 ? siteHref : `${siteHref}?previewAttempt=${loadAttempt}`

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      if (
        iframe.contentDocument?.readyState === 'complete' &&
        iframe.contentWindow?.location.href !== 'about:blank'
      ) {
        setLoadState('ready')
      }
    } catch {
      // The preview is same-origin today; onLoad remains the fallback if that changes.
    }
  }, [loadAttempt])

  useEffect(() => {
    if (loadState !== 'loading') return

    const timeoutId = window.setTimeout(() => setLoadState('error'), 15_000)
    return () => window.clearTimeout(timeoutId)
  }, [loadAttempt, loadState])

  return (
    <section
      aria-labelledby={titleId}
      className="flex h-full min-h-[calc(100dvh-3rem)] flex-1 flex-col bg-page lg:min-h-0"
    >
      <header className="flex min-h-control shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2">
        <h2 id={titleId} className="truncate text-sm font-semibold text-text-default">
          Syllabus
        </h2>
        <a
          href={siteHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(ACTIONBAR_BUTTON_SECONDARY_CLASSNAME, 'shrink-0')}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open syllabus
        </a>
      </header>

      <div className="relative min-h-0 flex-1 bg-page">
        {loadState !== 'ready' ? (
          <div className="absolute inset-0 z-floating flex bg-page">
            {loadState === 'loading' ? (
              <PageState kind="loading" title="Loading syllabus" compact />
            ) : (
              <PageState
                kind="error"
                title="Syllabus unavailable"
                description="The published syllabus could not be loaded."
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setLoadState('loading')
                      setLoadAttempt((attempt) => attempt + 1)
                    }}
                  >
                    Retry
                  </Button>
                }
                compact
              />
            )}
          </div>
        ) : null}

        <iframe
          key={loadAttempt}
          ref={iframeRef}
          title={`${classroomTitle} syllabus preview`}
          src={iframeSrc}
          tabIndex={loadState === 'ready' ? 0 : -1}
          aria-hidden={loadState !== 'ready'}
          onLoad={() => setLoadState('ready')}
          onError={() => setLoadState('error')}
          className="h-full min-h-[calc(100dvh-6.75rem)] w-full border-0 bg-page focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset lg:min-h-0"
        />
      </div>
    </section>
  )
}
