'use client'

import { useState } from 'react'
import { ExamDocumentWorkspace, type ExamDocumentItem } from '@/components/ExamDocumentWorkspace'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { FormField, Input } from '@/ui'

const DOCUMENTS: ExamDocumentItem[] = [
  { id: 'loops', title: 'Loop reference', source: 'text', content: '# Loops\nA **loop** repeats instructions. Use a loop when an action repeats.\n\n```\nwhile (frontIsClear()) {\n  move();\n}\n```' },
  { id: 'conditions', title: 'Condition reference', source: 'text', content: '# Conditions\nA condition decides whether the loop continues.\n\nCheck the condition before each step.' },
]

/** Deterministic feature evidence: production workspace, no API or student records. */
export function ExamTextFindPattern() {
  const [activeDocument, setActiveDocument] = useState<ExamDocumentItem | null>(null)
  return (
    <section id="exam-text-find" className="space-y-3">
      <h3 className="text-base font-semibold text-text-default">Exam text find</h3>
      <p className="text-sm text-text-muted">Feature-owned search for exam questions and text references.</p>
      <div className="h-96" data-testid="exam-text-find-example">
        <ExamDocumentWorkspace enableTextFind resetKey="find-example" activeDocument={activeDocument} documents={DOCUMENTS}
          onOpenDocument={setActiveDocument} onCloseDocument={() => setActiveDocument(null)}
          questionsPane={(
            <section className="h-full min-h-0 overflow-y-auto rounded-card border border-border bg-surface p-4">
              <QuestionMarkdown content={'# Loop practice\nExplain how a **loop** repeats an action.\n\nWhich condition stops the loop?'} />
              <div className="mt-4"><FormField label="Your response"><Input placeholder="Answer" /></FormField></div>
            </section>
          )}
        />
      </div>
    </section>
  )
}
