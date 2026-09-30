'use client'

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { findExamTextMatches, scrollExamTextMatchIntoView, type ExamTextMatch } from '@/lib/exam-text-find'

interface Options {
  rootRef: RefObject<HTMLDivElement>
  enabled: boolean
  locked: boolean
  resetKey: string
  onRevealDocument: (id: string) => void
}

export function useExamTextFind({ rootRef, enabled, locked, resetKey, onRevealDocument }: Options) {
  const revealDocumentRef = useRef(onRevealDocument)
  revealDocumentRef.current = onRevealDocument
  const id = useId().replace(/:/g, '')
  const highlightName = `exam-find-${id}`
  const currentHighlightName = `${highlightName}-current`
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<ExamTextMatch[]>([])
  const [index, setIndex] = useState(0)
  const current = matches[index] ?? null

  const open = useCallback(() => {
    if (locked) return
    if (!isOpen) returnFocusRef.current = document.activeElement as HTMLElement | null
    setIsOpen(true)
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
  }, [isOpen, locked])
  const close = useCallback(() => {
    setIsOpen(false)
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
  }, [])
  const move = useCallback((step: number) => {
    if (matches.length) setIndex((value) => (value + step + matches.length) % matches.length)
  }, [matches.length])

  useEffect(() => {
    setIsOpen(false)
    setQuery('')
    setMatches([])
    setIndex(0)
    returnFocusRef.current = null
  }, [resetKey, enabled])

  useEffect(() => {
    if (!enabled) return
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopImmediatePropagation()
        open()
      } else if (isOpen && event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [close, enabled, isOpen, open])

  useEffect(() => {
    if (!isOpen || locked || !rootRef.current) { setMatches([]); return }
    const root = rootRef.current
    const collect = () => {
      const found = findExamTextMatches(root, query)
      setMatches(found)
      setIndex((value) => Math.min(value, Math.max(0, found.length - 1)))
    }
    collect()
    const observer = new MutationObserver((records) => {
      if (records.some((record) => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement
        return element?.closest('[data-exam-search-text]') || Array.from(record.addedNodes).some((node) =>
          node instanceof Element && (node.matches('[data-exam-search-text]') || node.querySelector('[data-exam-search-text]')))
      })) collect()
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [isOpen, locked, query, rootRef])

  useEffect(() => {
    if (!isOpen || locked || !current) return
    if (current.documentId) revealDocumentRef.current(current.documentId)
    const frame = requestAnimationFrame(() => scrollExamTextMatchIntoView(current))
    return () => cancelAnimationFrame(frame)
  }, [current, isOpen, locked])

  useEffect(() => {
    if (!isOpen || locked || !globalThis.CSS?.highlights || typeof Highlight === 'undefined') return
    const all = new Highlight()
    for (const match of matches) all.add(match.range)
    const active = new Highlight(...(current ? [current.range] : []))
    active.priority = 1
    CSS.highlights.set(highlightName, all)
    CSS.highlights.set(currentHighlightName, active)
    return () => {
      CSS.highlights.delete(highlightName)
      CSS.highlights.delete(currentHighlightName)
    }
  }, [current, currentHighlightName, highlightName, isOpen, locked, matches])

  return {
    inputRef, isOpen, query, current, count: matches.length, index,
    highlightName, currentHighlightName, open, close, move,
    setQuery: (value: string) => { setQuery(value); setIndex(0) },
  }
}
