'use client'

import { useState } from 'react'
import { FormField, Input, cn } from '@/ui'
import { GRADEBOOK_NUMBER_INPUT_CLASS } from '@/lib/gradebook-display'
import { isValidGradebookMockupWeight } from './gradebook-mockup-state'

export function GradebookWeightInputMockup({
  title,
  weight,
  onChange,
}: {
  title: string
  weight: number
  onChange: (weight: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? String(weight)
  const valid = value.trim() !== '' && isValidGradebookMockupWeight(Number(value))

  return (
    <FormField label={`Category weight for ${title}`} hideLabel collapseHiddenLabel>
      <Input
        className={cn('px-1 text-center text-sm tabular-nums', GRADEBOOK_NUMBER_INPUT_CLASS)}
        type="number"
        min={1}
        max={999}
        step={1}
        value={value}
        aria-invalid={!valid}
        title="Enter a whole number from 1 to 999"
        onChange={(event) => {
          const nextValue = event.target.value
          setDraft(nextValue)
          if (nextValue.trim() !== '' && isValidGradebookMockupWeight(Number(nextValue))) {
            onChange(Number(nextValue))
          }
        }}
        onBlur={() => setDraft(null)}
      />
    </FormField>
  )
}
