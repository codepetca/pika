'use client'

import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { FormField, IconButton, Input } from '@/ui'
import type { useExamTextFind } from '@/hooks/use-exam-text-find'

export function ExamTextFindBar({ find }: { find: ReturnType<typeof useExamTextFind> }) {
  return (
    <div data-exam-find-controls role="search" aria-label="Find in exam" className="flex shrink-0 flex-wrap items-center gap-1 rounded-card border border-border bg-surface-2 p-2">
      <FormField label="Find in exam" hideLabel collapseHiddenLabel className="min-w-0 flex-1 basis-40">
        <Input ref={find.inputRef} placeholder="Find text" value={find.query} autoComplete="off" spellCheck={false}
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); find.move(event.shiftKey ? -1 : 1) }
          }}
        />
      </FormField>
      <span role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 basis-24 truncate px-2 text-sm text-text-muted">
        {find.query.trim() ? (find.count ? `${find.index + 1} of ${find.count} · ${find.current?.label}` : 'No matches') : 'Find in exam'}
      </span>
      <div className="flex shrink-0 items-center">
        <IconButton icon={ChevronUp} label="Previous match" variant="ghost" disabled={!find.count} onClick={() => find.move(-1)} />
        <IconButton icon={ChevronDown} label="Next match" variant="ghost" disabled={!find.count} onClick={() => find.move(1)} />
        <IconButton icon={X} label="Close find" variant="ghost" onClick={find.close} />
      </div>
      <style>{`
        ::highlight(${find.highlightName}) { background-color: var(--color-warning-bg); color: var(--color-warning); }
        ::highlight(${find.currentHighlightName}) { background-color: var(--color-primary-solid); color: var(--color-text-inverse); }
      `}</style>
    </div>
  )
}
