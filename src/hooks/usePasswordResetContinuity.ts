'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'

/** The public reset forms own their request activation and delayed continuation. */
export function usePasswordResetContinuity(pending: boolean) {
  const alive = useRef(true)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const owner = useRef<{
    control: HTMLElement
    eligible: boolean
    stop: () => void
  } | null>(null)
  const [completion, setCompletion] = useState(0)

  function retire() {
    alive.current = false
    generation.current += 1
    inFlight.current = false
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    owner.current?.stop()
    owner.current = null
  }

  useEffect(() => {
    alive.current = true
    return retire
  }, [])

  useEffect(() => {
    if (pending) return
    const activation = owner.current
    if (!activation) return
    activation.stop()
    owner.current = null
    if (
      alive.current && activation.eligible && activation.control.isConnected
      && document.activeElement === document.body
    ) {
      activation.control.focus({ preventScroll: true })
    }
  }, [pending, completion])

  function begin(form: HTMLFormElement): number | null {
    if (!alive.current || inFlight.current) return null
    inFlight.current = true
    generation.current += 1
    owner.current?.stop()
    owner.current = null
    const control = document.activeElement
    if (control instanceof HTMLElement && form.contains(control)) {
      const activation = { control, eligible: true, stop: () => {} }
      const moved = () => { activation.eligible = false }
      const focused = (event: FocusEvent) => {
        if (event.target !== control && event.target !== document.body) moved()
      }
      document.addEventListener('pointerdown', moved, true)
      document.addEventListener('keydown', moved, true)
      document.addEventListener('focusin', focused, true)
      activation.stop = () => {
        document.removeEventListener('pointerdown', moved, true)
        document.removeEventListener('keydown', moved, true)
        document.removeEventListener('focusin', focused, true)
      }
      owner.current = activation
    }
    return generation.current
  }

  function isCurrent(request: number) {
    return alive.current && request === generation.current
  }

  function finish(request: number) {
    if (!isCurrent(request)) return
    inFlight.current = false
    setCompletion(current => current + 1)
  }

  function release(request: number) {
    if (!isCurrent(request)) return
    inFlight.current = false
    owner.current?.stop()
    owner.current = null
  }

  function continueAfter(request: number, callback: () => void, delay: number) {
    if (!isCurrent(request)) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (isCurrent(request)) callback()
    }, delay)
  }

  return { begin, isCurrent, finish, release, continueAfter, retire }
}

/** Uppercase the reset code without letting React move a native insertion caret. */
export function useUppercaseResetCode() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [edit, setEdit] = useState({ value: '', start: 0, end: 0, direction: 'none' as 'forward' | 'backward' | 'none' })

  useLayoutEffect(() => {
    const input = inputRef.current
    if (input && document.activeElement === input) {
      input.setSelectionRange(edit.start, edit.end, edit.direction)
    }
  }, [edit])

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const value = input.value
    setEdit({
      value: value.toUpperCase(),
      start: value.slice(0, input.selectionStart ?? value.length).toUpperCase().length,
      end: value.slice(0, input.selectionEnd ?? value.length).toUpperCase().length,
      direction: input.selectionDirection ?? 'none',
    })
  }

  return { code: edit.value, inputRef, onChange }
}
