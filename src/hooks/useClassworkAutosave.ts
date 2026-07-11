'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClassworkModalSaveStatusValue } from '@/components/classwork/ClassworkContentModal'

type UseClassworkAutosaveOptions<T> = {
  disabled?: boolean
  debounceMs?: number
  minIntervalMs?: number
  isEqual: (left: T, right: T) => boolean
  onSave: (values: T) => Promise<T | void>
  onError?: (message: string) => void
}

type SaveOptions = {
  force?: boolean
}

const DEFAULT_DEBOUNCE_MS = 3000
const DEFAULT_MIN_INTERVAL_MS = 10000

export function useClassworkAutosave<T>({
  disabled = false,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  isEqual,
  onSave,
  onError,
}: UseClassworkAutosaveOptions<T>) {
  const [status, setStatus] = useState<ClassworkModalSaveStatusValue>('saved')
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const throttledTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaveAtRef = useRef(0)
  const lastSavedValuesRef = useRef<T | null>(null)
  const pendingValuesRef = useRef<T | null>(null)
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null)
  const disabledRef = useRef(disabled)
  const isEqualRef = useRef(isEqual)
  const onSaveRef = useRef(onSave)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    isEqualRef.current = isEqual
  }, [isEqual])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const clearTimers = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      debounceTimeoutRef.current = null
    }
    if (throttledTimeoutRef.current) {
      clearTimeout(throttledTimeoutRef.current)
      throttledTimeoutRef.current = null
    }
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const reset = useCallback((values: T | null) => {
    clearTimers()
    lastSavedValuesRef.current = values
    pendingValuesRef.current = null
    lastSaveAtRef.current = values ? Date.now() : 0
    setStatus(values ? 'saved' : 'saving')
  }, [clearTimers])

  const drainPending = useCallback(() => {
    if (inFlightSaveRef.current) return inFlightSaveRef.current

    const savePromise = (async () => {
      while (pendingValuesRef.current && !disabledRef.current) {
        const values = pendingValuesRef.current
        const saved = lastSavedValuesRef.current

        if (saved && isEqualRef.current(saved, values)) {
          pendingValuesRef.current = null
          setStatus('saved')
          return true
        }

        setStatus('saving')
        lastSaveAtRef.current = Date.now()

        try {
          const savedValues = await onSaveRef.current(values)
          lastSavedValuesRef.current = savedValues ?? values
          if (
            pendingValuesRef.current
            && isEqualRef.current(pendingValuesRef.current, values)
          ) {
            pendingValuesRef.current = null
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to save changes'
          onErrorRef.current?.(message)
          setStatus('unsaved')
          return false
        }
      }

      if (!pendingValuesRef.current) setStatus('saved')
      return true
    })()

    inFlightSaveRef.current = savePromise
    void savePromise.finally(() => {
      if (inFlightSaveRef.current === savePromise) {
        inFlightSaveRef.current = null
      }
    })
    return savePromise
  }, [])

  const queueSave = useCallback((values: T, options?: SaveOptions) => {
    if (disabledRef.current) return

    pendingValuesRef.current = values

    if (throttledTimeoutRef.current) {
      clearTimeout(throttledTimeoutRef.current)
      throttledTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastSave = now - lastSaveAtRef.current

    if (options?.force || msSinceLastSave >= minIntervalMs) {
      void drainPending()
      return
    }

    throttledTimeoutRef.current = setTimeout(() => {
      throttledTimeoutRef.current = null
      void drainPending()
    }, minIntervalMs - msSinceLastSave)
  }, [drainPending, minIntervalMs])

  const schedule = useCallback((values: T) => {
    if (disabledRef.current) return

    const saved = lastSavedValuesRef.current
    if (saved && isEqualRef.current(saved, values) && !inFlightSaveRef.current) {
      pendingValuesRef.current = null
      setStatus('saved')
      return
    }

    pendingValuesRef.current = values
    setStatus('unsaved')

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      debounceTimeoutRef.current = null
      queueSave(values)
    }, debounceMs)
  }, [debounceMs, queueSave])

  const flush = useCallback(async () => {
    const pending = pendingValuesRef.current
    if (!pending || disabledRef.current) return true
    clearTimers()
    return drainPending()
  }, [clearTimers, drainPending])

  return {
    status,
    reset,
    schedule,
    flush,
  }
}
