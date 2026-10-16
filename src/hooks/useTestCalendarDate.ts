'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { TEACHER_TESTS_UPDATED_EVENT } from '@/lib/events'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { TestAssessment } from '@/types'

/** Calendar metadata saves separately from questions and publication. */
export function useTestCalendarDate({
  test,
  classroomId,
  apiBasePath,
  onSaved,
}: {
  test: TestAssessment
  classroomId: string
  apiBasePath: string
  onSaved: (test: TestAssessment) => void
}) {
  const scope = JSON.stringify([apiBasePath, classroomId, test.id])
  const [value, setValue] = useState(test.test_date ?? '')
  const [savedValue, setSavedValue] = useState(test.test_date ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [valid, setValid] = useState(true)
  const ownerRef = useRef({ scope, generation: 0, saved: test.test_date ?? '', value: test.test_date ?? '', valid: true })
  const pendingRef = useRef<Promise<boolean> | null>(null)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  const initialDateRef = useRef(test.test_date ?? '')
  initialDateRef.current = test.test_date ?? ''

  useLayoutEffect(() => {
    const owner = { scope, generation: ownerRef.current.generation + 1, saved: initialDateRef.current, value: initialDateRef.current, valid: true }
    ownerRef.current = owner
    pendingRef.current = null
    setValue(owner.value)
    setSavedValue(owner.saved)
    setError('')
    setSaving(false)
    setValid(true)
    return () => { owner.generation += 1 }
    // Refreshes of the same Test must not replace an unsaved failed date.
  }, [scope])

  useLayoutEffect(() => {
    const next = test.test_date ?? ''
    const owner = ownerRef.current
    if (pendingRef.current || owner.value !== owner.saved || !owner.valid) return
    owner.saved = next
    owner.value = next
    setValue(next)
    setSavedValue(next)
  }, [test.test_date])

  const edit = useCallback((next: string, complete = true) => {
    ownerRef.current.value = next
    ownerRef.current.valid = complete
    setValue(next)
    setValid(complete)
    setError('')
  }, [])

  const save = useCallback((next: string): Promise<boolean> => {
    if (pendingRef.current) return pendingRef.current
    const owner = ownerRef.current
    const generation = owner.generation
    owner.value = next
    owner.valid = true
    setValue(next)
    setValid(true)
    if (next === owner.saved) {
      setError('')
      return Promise.resolve(true)
    }
    setSaving(true)
    setError('')
    const pending = (async () => {
      try {
        const response = await fetch(`${apiBasePath}/${test.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test_date: next || null }),
        })
        const data = await response.json() as { test?: TestAssessment; error?: string }
        if (ownerRef.current !== owner || owner.generation !== generation) return false
        if (!response.ok || !data.test || data.test.id !== test.id || data.test.classroom_id !== classroomId || (data.test.test_date ?? '') !== next) {
          throw new Error(data.error || 'Failed to save test date')
        }
        owner.saved = next
        setSavedValue(next)
        invalidateCachedJSON(`teacher-tests:${classroomId}`)
        onSavedRef.current(data.test)
        window.dispatchEvent(new CustomEvent(TEACHER_TESTS_UPDATED_EVENT, { detail: { classroomId } }))
        return true
      } catch (cause) {
        if (ownerRef.current === owner && owner.generation === generation) {
          setError(cause instanceof Error ? cause.message : 'Failed to save test date')
        }
        return false
      } finally {
        if (ownerRef.current === owner && owner.generation === generation) {
          setSaving(false)
          pendingRef.current = null
        }
      }
    })()
    pendingRef.current = pending
    return pending
  }, [apiBasePath, classroomId, test.id])

  const flush = useCallback(() => {
    if (!ownerRef.current.valid) {
      setError('Enter a complete test date')
      return Promise.resolve(false)
    }
    return pendingRef.current ?? save(ownerRef.current.value)
  }, [save])
  return { value, savedValue, error, saving, dirty: !valid || value !== savedValue, edit, save, flush }
}
