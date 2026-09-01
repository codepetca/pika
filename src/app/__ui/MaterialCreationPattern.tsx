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
  const [title, setTitle] = useState('Field guide')
  const [content, setContent] = useState(SAMPLE_CONTENT)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState('Example only—nothing is saved or posted.')

  return (
    <section id="material-creation">
    <Card tone="panel" padding="md">
      <h3 className="font-semibold">Material creation · proposed shared bar</h3>
      <p className="mt-2 text-sm text-text-muted">Production editor, icon-only Preview, and Post / Save draft actions.</p>
      <Button variant="surface" className="mt-3" onClick={() => {
        setTitle('Field guide')
        setContent(SAMPLE_CONTENT)
        setError(null)
        setOpen(true)
      }}>Open material example</Button>
      <p role="status" className="mt-2 text-xs text-text-muted">{result}</p>
      <MaterialCreationDialog
        isOpen={open}
        title={title}
        content={content}
        error={error}
        onTitleChange={setTitle}
        onContentChange={setContent}
        onClose={() => setOpen(false)}
        onSave={(asDraft) => {
          if (!title.trim()) { setError('Title is required'); return }
          setResult(`${asDraft ? 'Save draft' : 'Post'} selected. Example only—nothing was saved or posted.`)
          setOpen(false)
        }}
      />
    </Card>
    </section>
  )
}
