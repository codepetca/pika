'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, PageState } from '@/ui'

type EmbedState = 'loading' | 'authenticating' | 'ready' | 'error'
type EmbedTheme = 'light' | 'dark'

type PalEmbedMessage = {
  type?: unknown
  nonce?: unknown
}

export function StudentAchievementsTab({
  embedUrl,
  isActive,
}: {
  embedUrl: string | null
  isActive: boolean
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const authRequestedRef = useRef(false)
  const themeRef = useRef<EmbedTheme>('light')
  const [loadKey, setLoadKey] = useState(0)
  const [nonce, setNonce] = useState<string | null>(null)
  const [state, setState] = useState<EmbedState>('loading')
  const [theme, setTheme] = useState<EmbedTheme>('light')
  const embedOrigin = useMemo(() => {
    if (!embedUrl) return null
    try {
      return new URL(embedUrl).origin
    } catch {
      return null
    }
  }, [embedUrl])
  const iframeUrl = useMemo(() => {
    if (!embedUrl || !nonce) return null
    try {
      const url = new URL(embedUrl)
      url.hash = `pika_nonce=${encodeURIComponent(nonce)}`
      return url.toString()
    } catch {
      return null
    }
  }, [embedUrl, nonce])

  useEffect(() => {
    const root = document.documentElement
    const updateTheme = () => {
      const nextTheme = root.classList.contains('dark') ? 'dark' : 'light'
      themeRef.current = nextTheme
      setTheme(nextTheme)
    }
    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!isActive || !embedOrigin) return
    authRequestedRef.current = false
    setNonce(crypto.randomUUID())
    setState('loading')
  }, [embedOrigin, isActive, loadKey])

  useEffect(() => {
    if (!isActive || !embedOrigin || !nonce) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => setState('error'), 12_000)

    async function handleMessage(event: MessageEvent<PalEmbedMessage>) {
      if (
        event.origin !== embedOrigin
        || event.source !== iframeRef.current?.contentWindow
        || event.data?.nonce !== nonce
      ) {
        return
      }

      if (event.data.type === 'pal.embed.authenticated') {
        window.clearTimeout(timeout)
        setState('ready')
        return
      }
      if (event.data.type === 'pal.embed.error') {
        window.clearTimeout(timeout)
        setState('error')
        return
      }
      if (event.data.type !== 'pal.embed.ready' || authRequestedRef.current) return

      authRequestedRef.current = true
      setState('authenticating')
      try {
        const response = await fetch('/api/student/pal/read-token', {
          method: 'POST',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Pal token request failed')
        const body = await response.json() as { token?: unknown }
        if (typeof body.token !== 'string' || !body.token) {
          throw new Error('Pal token response was invalid')
        }
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'pal.embed.authenticate',
            nonce,
            token: body.token,
            theme: themeRef.current,
          },
          embedOrigin,
        )
      } catch {
        if (!controller.signal.aborted) {
          window.clearTimeout(timeout)
          setState('error')
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
      window.removeEventListener('message', handleMessage)
    }
  }, [embedOrigin, isActive, nonce])

  useEffect(() => {
    if (state !== 'ready' || !embedOrigin || !nonce) return
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'pal.embed.appearance',
        nonce,
        theme,
      },
      embedOrigin,
    )
  }, [embedOrigin, nonce, state, theme])

  const retry = useCallback(() => {
    setLoadKey((current) => current + 1)
  }, [])

  if (!embedOrigin) {
    return (
      <PageState
        kind="error"
        title="Achievements are unavailable"
        description="The Pal roadmap has not been configured for this Pika environment."
        compact
      />
    )
  }

  return (
    <div className="relative flex min-h-[28rem] flex-1 overflow-hidden rounded-card border border-border bg-surface">
      {iframeUrl ? (
        <iframe
          key={iframeUrl}
          ref={iframeRef}
          src={iframeUrl}
          title="Pal achievements roadmap"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          style={{ colorScheme: theme }}
          className={[
            'min-h-[28rem] w-full flex-1 border-0 bg-surface transition-opacity',
            state === 'ready' ? 'opacity-100' : 'pointer-events-none opacity-0',
          ].join(' ')}
        />
      ) : null}

      {state === 'loading' || state === 'authenticating' ? (
        <PageState
          kind="loading"
          title="Loading achievements"
          description="Connecting securely to Pal."
          compact
          className="absolute inset-0 bg-surface"
        />
      ) : null}
      {state === 'error' ? (
        <PageState
          kind="error"
          title="Achievements are temporarily unavailable"
          description="Your Pika work is safe. Try loading the roadmap again."
          action={<Button variant="secondary" onClick={retry}>Try again</Button>}
          compact
          className="absolute inset-0 bg-surface"
        />
      ) : null}
    </div>
  )
}
