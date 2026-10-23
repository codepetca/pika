'use client'

import type { ReactNode } from 'react'
import { Code, Pencil } from 'lucide-react'
import { SaveStatus, SegmentedControl, type SaveStatusState } from '@/ui'

interface QuestionAuthoringHeaderProps {
  questionNumber: number
  points?: ReactNode
  navigation: ReactNode
  status: SaveStatusState
  mode: 'edit' | 'markdown'
  onModeChange: (mode: 'edit' | 'markdown') => void
  writeDisabled?: boolean
  markdownDisabled?: boolean
  testId?: string
}

/** Shared test/survey question context and navigation; draft ownership stays with each workspace. */
export function QuestionAuthoringHeader({
  questionNumber, points, navigation, status, mode, onModeChange,
  writeDisabled = false, markdownDisabled = false, testId,
}: QuestionAuthoringHeaderProps) {
  return (
    <div data-testid={testId} className="modal-question-controls-row grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-3 sm:min-h-[76px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4 sm:py-4">
      <div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-3 sm:flex-nowrap">
        <strong className="shrink-0 text-base text-text-default">Q{questionNumber}</strong>
        {points}
      </div>
      <div className="col-span-2 col-start-1 row-start-2 justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {navigation}
      </div>
      <div className="modal-question-controls-tail col-start-2 row-start-1 flex items-center justify-self-end gap-2 pr-14 sm:col-start-3">
        <SaveStatus presentation="indicator" status={status} />
        <SegmentedControl
          ariaLabel="Authoring mode"
          value={mode}
          onChange={onModeChange}
          iconOnly
          className="bg-transparent p-0"
          options={[
            { value: 'edit', label: 'Write', tooltip: 'Write', icon: <Pencil className="h-4 w-4" aria-hidden="true" />, disabled: writeDisabled },
            { value: 'markdown', label: 'Markdown', tooltip: 'Markdown', icon: <Code className="h-4 w-4" aria-hidden="true" />, disabled: markdownDisabled },
          ]}
        />
      </div>
    </div>
  )
}
