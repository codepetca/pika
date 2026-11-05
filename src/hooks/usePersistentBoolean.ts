'use client'

import { useEffect, useState } from 'react'
import { safeLocalGetJson, safeLocalSetJson } from '@/lib/client-storage'

/** A browser-local display preference; invalid or unavailable storage uses the default. */
export function usePersistentBoolean(key: string, defaultValue: boolean) {
  const [value, setValue] = useState(defaultValue)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const stored = safeLocalGetJson<unknown>(key)
    if (typeof stored === 'boolean') setValue(stored)
    setLoaded(true)
  }, [key])

  useEffect(() => {
    if (loaded) safeLocalSetJson(key, value)
  }, [key, loaded, value])

  return [value, setValue] as const
}
