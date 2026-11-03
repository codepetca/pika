'use client'

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

export function AutoGrowingTextarea({ value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`
    }
    resize()
    let width = textarea.clientWidth
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (textarea.clientWidth !== width) {
        width = textarea.clientWidth
        resize()
      }
    })
    observer?.observe(textarea)
    return () => observer?.disconnect()
  }, [value])

  return <textarea {...props} ref={textareaRef} value={value} />
}
