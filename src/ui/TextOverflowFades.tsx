'use client'

import { useEffect } from 'react'

const LABELS = '.truncate, .text-ellipsis, .tiptap-button-text, .tiptap-badge-text'
const CONTROL = 'button, input, select, textarea, td, th'
const FADED = 'data-text-fades'

function visitLabels(node: Node, visit: (label: HTMLElement) => void) {
  if (!(node instanceof Element)) return
  if (node instanceof HTMLElement && node.matches(LABELS)) visit(node)
  node.querySelectorAll<HTMLElement>(LABELS).forEach(visit)
}

/** Enhance the existing truncation utilities without changing their layout. */
export function TextOverflowFades() {
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || typeof CSS === 'undefined' ||
      !CSS.supports('mask-image', 'linear-gradient(black, transparent)')) return

    const labels = new Set<HTMLElement>()
    const pending = new Set<HTMLElement>()
    let frame = 0
    let active = true
    const measure = () => {
      frame = 0
      // Read all measurements before updating attributes to avoid layout thrashing.
      const results = Array.from(pending, label => ({
        label,
        overflows: label.isConnected && label.clientWidth > 0 && label.scrollWidth > label.clientWidth,
      }))
      pending.clear()
      for (const { label, overflows } of results) label.toggleAttribute(FADED, overflows)
    }
    const queue = (label: HTMLElement) => {
      if (!active || !labels.has(label)) return
      pending.add(label)
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(entries => {
      for (const { target } of entries) queue(target as HTMLElement)
    })
    const forget = (label: HTMLElement) => {
      if (!labels.delete(label)) return
      resize.unobserve(label)
      pending.delete(label)
      label.removeAttribute(FADED)
    }
    const sync = (label: HTMLElement) => {
      const clips = label.matches('.truncate, .text-ellipsis') ||
        label.matches('[data-text-trim="on"] :is(.tiptap-button-text, .tiptap-badge-text)')
      if (!clips || label.matches(CONTROL)) {
        forget(label)
        return
      }
      if (!labels.has(label)) {
        labels.add(label)
        resize.observe(label)
      }
      queue(label)
    }
    const mutations = new MutationObserver(records => {
      let removed = false
      for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement
        if (record.type === 'attributes') {
          if (record.attributeName === 'data-text-trim') {
            visitLabels(record.target, sync)
          } else if (element instanceof HTMLElement && (labels.has(element) || element.matches(LABELS))) {
            sync(element)
          }
        } else {
          const label = element?.closest<HTMLElement>(LABELS)
          if (label) queue(label)
          for (const node of record.addedNodes) visitLabels(node, sync)
          removed ||= Array.from(record.removedNodes).some(node => node instanceof Element)
        }
      }
      if (removed) {
        for (const label of labels) {
          if (!label.isConnected) forget(label)
        }
      }
    })
    const remeasure = () => labels.forEach(queue)
    visitLabels(document.body, sync)
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['class', 'data-text-trim'],
    })
    document.fonts?.addEventListener('loadingdone', remeasure)
    void document.fonts?.ready.then(remeasure)

    return () => {
      active = false
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      document.fonts?.removeEventListener('loadingdone', remeasure)
      for (const label of labels) label.removeAttribute(FADED)
    }
  }, [])

  return null
}
