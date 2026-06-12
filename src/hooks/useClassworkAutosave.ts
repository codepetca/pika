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

  const saveNow = useCallback(async (values: T) => {
    if (disabledRef.current) return true

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
      const latestPending = pendingValuesRef.current
      if (latestPending && !isEqualRef.current(latestPending, values)) {
        return
      }
      lastSavedValuesRef.current = savedValues ?? values
      pendingValuesRef.current = null
      setStatus('saved')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes'
      onErrorRef.current?.(message)
      setStatus('unsaved')
      return false
    }
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
      void saveNow(values)
      return
    }

    throttledTimeoutRef.current = setTimeout(() => {
      throttledTimeoutRef.current = null
      const latest = pendingValuesRef.current
      if (latest) {
        void saveNow(latest)
      }
    }, minIntervalMs - msSinceLastSave)
  }, [minIntervalMs, saveNow])

  const schedule = useCallback((values: T) => {
    if (disabledRef.current) return

    const saved = lastSavedValuesRef.current
    if (saved && isEqualRef.current(saved, values)) {
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
    return saveNow(pending)
  }, [clearTimers, saveNow])

  return {
    status,
    reset,
    schedule,
    flush,
  }
}
