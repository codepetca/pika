'use client'

import { useState } from 'react'
import { MarkdownAuthoringEditor, type MarkdownAuthoringMode } from '@/components/editor'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { Card } from '@/ui'

const SAMPLE = '# Field observations\n\nRead the **field guide** before our next class.\n\n- Bring one observation.\n- Bring one question.\n\n> Describe what you noticed.\n'

export function MarkdownAuthoringPattern({ role }: { role: 'teacher' | 'student' }) {
  const [markdown, setMarkdown] = useState(SAMPLE)
  const [mode, setMode] = useState<MarkdownAuthoringMode>('visual')
  return (
    <section id="markdown-authoring">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Write / Markdown · authoring</h3>
        <p className="mb-3 mt-2 text-sm text-text-muted">
          Course Guide and assignment instructions share one Markdown draft and a quiet formatting menu.
          This scoped composition is experimental for further adopters.
        </p>
        {role === 'teacher' ? <MarkdownAuthoringEditor label="Course guide" markdown={markdown}
          onMarkdownChange={setMarkdown} mode={mode} onModeChange={setMode} />
          : <LimitedMarkdown content={markdown} />}
      </Card>
    </section>
  )
}
