'use client'

import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button, IconButton, PageState } from '@/ui'

interface Props {
  title: string
  url: string
}

/** A new file starts with fresh load/zoom state without remounting the test form. */
export function TestImageDocumentViewer(props: Props) {
  return <ImageDocument key={props.url} {...props} />
}

function ImageDocument({ title, url }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [zoom, setZoom] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const src = attempt ? `${url}${url.includes('?') ? '&' : '?'}image_retry=${attempt}` : url

  useEffect(() => {
    // Cached images may finish before React attaches the load handler during hydration.
    const image = imageRef.current
    if (!image?.complete) return
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setDimensions({ width: image.naturalWidth, height: image.naturalHeight })
      setStatus('loaded')
    } else {
      setStatus('error')
    }
  }, [src])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitScale = dimensions.width && dimensions.height && viewport.width && viewport.height
    ? Math.min(1, viewport.width / dimensions.width, viewport.height / dimensions.height)
    : 1
  const width = dimensions.width * fitScale * zoom
  const height = dimensions.height * fitScale * zoom
  const loaded = status === 'loaded'

  function fitImage() {
    setZoom(1)
    viewportRef.current?.scrollTo?.({ left: 0, top: 0 })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div role="group" aria-label="Image controls" className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-b border-border bg-surface-2 px-2">
        <IconButton icon={ZoomOut} label="Zoom out" variant="ghost" disabled={!loaded || zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))} />
        <span aria-live="polite" className="min-w-12 text-center text-xs tabular-nums text-text-muted">
          {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </span>
        <IconButton icon={ZoomIn} label="Zoom in" variant="ghost" disabled={!loaded || zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.25))} />
        <Button type="button" variant="ghost" size="sm" aria-label="Fit image" disabled={!loaded} onClick={fitImage}>Fit</Button>
      </div>
      <div
        ref={viewportRef}
        role="region"
        aria-label={`${title} image`}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        {status === 'loading' ? <PageState kind="loading" title="Loading image" compact /> : null}
        {status === 'error' ? (
          <PageState
            kind="error"
            title="Image unavailable"
            compact
            action={<Button type="button" variant="secondary" onClick={() => { setStatus('loading'); setDimensions({ width: 0, height: 0 }); fitImage(); setAttempt((value) => value + 1) }}>Try again</Button>}
          />
        ) : null}
        <div
          className={loaded ? 'flex items-center justify-center' : 'hidden'}
          style={loaded ? { width: Math.max(viewport.width, width), height: Math.max(viewport.height, height) } : undefined}
        >
          {/* Keep private delivery on the authenticated file route; image optimization cannot forward its session. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            ref={imageRef}
            src={src}
            alt={title}
            draggable={false}
            className="max-w-none shrink-0 bg-reference-image-canvas"
            style={{ width: width || undefined, height: height || undefined }}
            onLoad={(event) => {
              setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              setStatus('loaded')
            }}
            onError={() => setStatus('error')}
          />
        </div>
      </div>
    </div>
  )
}
