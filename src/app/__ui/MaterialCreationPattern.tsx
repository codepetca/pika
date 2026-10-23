'use client'

import { useState } from 'react'
import { Button, Card } from '@/ui'
import { MaterialCreationDialog } from '@/components/materials/MaterialCreationDialog'
import type { TiptapContent } from '@/types'

const SAMPLE_CONTENT: TiptapContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Read the field guide before our next class.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bring one observation and one question to discuss.' }] },
  ],
}

export function MaterialCreationPattern() {
  const [open, setOpen] = useState(false)
  const [existing, setExisting] = useState(false)
  const [title, setTitle] = useState('Field guide')
  const [content, setContent] = useState(SAMPLE_CONTENT)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState('Example only—nothing is saved or posted.')

  return (
    <section id="material-creation">
    <Card tone="panel" padding="md">
      <h3 className="font-semibold">Material creation</h3>
      <p className="mt-2 text-sm text-text-muted">Assignment-style details and content panes with Write / Markdown editing, Preview, and Post / Schedule / Save draft actions. Materials have no due date.</p>
      <Button variant="surface" className="mt-3" onClick={() => {
        setExisting(false)
        setTitle('Field guide')
        setContent(SAMPLE_CONTENT)
        setError(null)
        setOpen(true)
      }}>Open material example</Button>
      <Button variant="surface" className="ml-2 mt-3" onClick={() => {
        setExisting(true)
        setTitle('Field guide')
        setContent(SAMPLE_CONTENT)
        setError(null)
        setOpen(true)
      }}>Edit posted material example</Button>
      <p role="status" className="mt-2 text-xs text-text-muted">{result}</p>
      <MaterialCreationDialog
        classroomName="Health for Life · Period 2 · Community, wellbeing and lifelong learning"
        isOpen={open}
        materialKey={existing ? 'posted' : 'new'}
        isExisting={existing}
        isDraft={!existing}
        releasedAt={existing ? '2026-01-22T17:00:00Z' : null}
        title={title}
        content={content}
        error={error}
        onTitleChange={setTitle}
        onContentChange={setContent}
        onClose={() => setOpen(false)}
        onSave={(asDraft, _scheduledFor, postedOn) => {
          if (!title.trim()) { setError('Title is required'); return }
          setResult(`${postedOn ? `Post date ${postedOn}` : asDraft ? 'Save draft' : 'Post'} selected. Example only—nothing was saved or posted.`)
          setOpen(false)
        }}
      />
    </Card>
    </section>
  )
}
