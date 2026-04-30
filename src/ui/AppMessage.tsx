'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from './utils'

export type AppMessageTone = 'loading' | 'info' | 'success' | 'warning'

export interface ShowAppMessageOptions {
  text: string
  tone?: AppMessageTone
  /**
   * Defaults to a short auto-dismiss. Pass 0 for state-driven messages that
   * should stay visible until the caller clears or replaces them.
   */
  durationMs?: number
}

interface AppMessageState {
  id: string
  text: string
  tone: AppMessageTone
}

interface AppMessageContextValue {
  showMessage: (options: ShowAppMessageOptions) => string
  clearMessage: (id?: string) => void
}

interface UseOverlayMessageOptions {
  tone?: AppMessageTone
  delayMs?: number
}

const DEFAULT_DURATION_MS = 1800
const WARNING_DURATION_MS = 2400

const AppMessageContext = createContext<AppMessageContextValue | null>(null)

const toneClassNames: Record<AppMessageTone, string> = {
  loading: 'border-border bg-surface text-text-default',
  info: 'border-primary bg-info-bg text-info',
  success: 'border-success bg-success-bg text-success',
  warning: 'border-warning bg-warning-bg text-warning',
}

function getDefaultDurationMs(tone: AppMessageTone): number {
  return tone === 'warning' ? WARNING_DURATION_MS : DEFAULT_DURATION_MS
}

function trimStaticEllipsis(text: string) {
  return text.replace(/[\s.。…]+$/, '')
}

function LoadingMessageText({ text }: { text: string }) {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setDotCount((current) => (current >= 3 ? 1 : current + 1))
    }, 420)
    return () => window.clearInterval(intervalId)
  }, [])

  return (
    <span className="truncate">
      {trimStaticEllipsis(text)}
      <span aria-hidden="true">{'.'.repeat(dotCount)}</span>
    </span>
  )
}

export function AppMessageProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<AppMessageState | null>(null)
  const messageRef = useRef<AppMessageState | null>(null)
  const autoDismissTimerRef = useRef<number | null>(null)
  const nextIdRef = useRef(0)

  const clearAutoDismissTimer = useCallback(() => {
    if (autoDismissTimerRef.current == null) return
    window.clearTimeout(autoDismissTimerRef.current)
    autoDismissTimerRef.current = null
  }, [])

  const dismissMessage = useCallback((id?: string) => {
    const currentMessage = messageRef.current
    if (id && currentMessage?.id !== id) return

    clearAutoDismissTimer()
    messageRef.current = null
    setMessage(null)
  }, [clearAutoDismissTimer])

  const clearMessage = useCallback((id?: string) => {
    dismissMessage(id)
  }, [dismissMessage])

  const showMessage = useCallback((options: ShowAppMessageOptions) => {
    const text = options.text.trim()
    if (!text) {
      dismissMessage()
      return ''
    }

    clearAutoDismissTimer()

    const tone = options.tone ?? 'info'
    const id = `app-message-${Date.now()}-${nextIdRef.current}`
    nextIdRef.current += 1
    const nextMessage = { id, text, tone }
    messageRef.current = nextMessage
    setMessage(nextMessage)

    const durationMs = options.durationMs ?? getDefaultDurationMs(tone)
    if (durationMs > 0) {
      autoDismissTimerRef.current = window.setTimeout(() => {
        dismissMessage(id)
      }, durationMs)
    }

    return id
  }, [
    clearAutoDismissTimer,
    dismissMessage,
  ])

  useEffect(() => () => {
    clearAutoDismissTimer()
  }, [clearAutoDismissTimer])

  const value = useMemo<AppMessageContextValue>(
    () => ({ showMessage, clearMessage }),
    [clearMessage, showMessage],
  )

  return (
    <AppMessageContext.Provider value={value}>
      {children}
      {message ? (
        <div
          data-testid="app-message-overlay"
          className="pointer-events-none fixed left-1/2 top-6 z-[80] flex w-[calc(100%-8rem)] max-w-[14rem] -translate-x-1/2 -translate-y-1/2 justify-center sm:max-w-md"
          aria-live="polite"
          aria-atomic="true"
          role="status"
        >
          <div
            data-testid="app-message-pill"
            className={cn(
              'inline-flex min-h-8 max-w-full items-center truncate rounded-badge border px-3 py-1.5 text-sm font-medium leading-none shadow-elevated',
              toneClassNames[message.tone],
            )}
          >
            {message.tone === 'loading' ? (
              <LoadingMessageText text={message.text} />
            ) : (
              <span className="truncate">{message.text}</span>
            )}
          </div>
        </div>
      ) : null}
    </AppMessageContext.Provider>
  )
}

export function useAppMessage() {
  const context = useContext(AppMessageContext)
  if (!context) {
    throw new Error('useAppMessage must be used within AppMessageProvider')
  }
  return context
}

export function useOverlayMessage(
  active: boolean,
  text: string,
  options: UseOverlayMessageOptions = {},
) {
  const { showMessage, clearMessage } = useAppMessage()
  const messageIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!active) {
      if (messageIdRef.current) {
        clearMessage(messageIdRef.current)
        messageIdRef.current = null
      }
      return
    }

    const delayMs = options.delayMs ?? 180
    const timeoutId = window.setTimeout(() => {
      messageIdRef.current = showMessage({
        text,
        tone: options.tone ?? 'loading',
        durationMs: 0,
      })
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
      if (messageIdRef.current) {
        clearMessage(messageIdRef.current)
        messageIdRef.current = null
      }
    }
  }, [active, clearMessage, options.delayMs, options.tone, showMessage, text])
}

export function AppMessageFallback({
  label = 'Loading',
}: {
  label?: string
}) {
  useOverlayMessage(true, label, { tone: 'loading', delayMs: 0 })
  return null
}
