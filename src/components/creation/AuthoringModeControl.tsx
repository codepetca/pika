'use client'

import { Code2, Pencil } from 'lucide-react'
import { SegmentedControl } from '@/ui'

/** The two authoring views share a draft; the owning editor controls transitions. */
export function AuthoringModeControl({ value, onChange, ariaLabel, writeDisabled = false, markdownDisabled = false }: {
  value: 'write' | 'markdown'
  onChange: (value: 'write' | 'markdown') => void
  ariaLabel: string
  writeDisabled?: boolean
  markdownDisabled?: boolean
}) {
  return <SegmentedControl
    ariaLabel={ariaLabel}
    value={value}
    onChange={onChange}
    className="w-full [&>button]:flex-1"
    options={[
      { value: 'write', label: 'Write', icon: <Pencil className="h-4 w-4" aria-hidden="true" />, disabled: writeDisabled },
      { value: 'markdown', label: 'Markdown', icon: <Code2 className="h-4 w-4" aria-hidden="true" />, disabled: markdownDisabled },
    ]}
  />
}
