'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, ContentDialog, SegmentedControl, type SegmentedControlOption } from '@/ui'

interface FeedbackDialogProps {
  isOpen: boolean
  onClose: () => void
}

type Category = 'bug' | 'suggestion'

const categoryOptions: Array<SegmentedControlOption<Category>> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'suggestion', label: 'Suggestion' },
]

export function FeedbackDialog({ isOpen, onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<Category>('bug')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const version = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown'
  const commit = (process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown').slice(0, 7)
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV || 'development'

  function handleClose() {
    if (state !== 'submitting') {
      if (timerRef.current) clearTimeout(timerRef.current)
      setCategory('bug')
      setDescription('')
      setState('idle')
      setErrorMsg('')
      onClose()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (description.trim().length < 10) {
      setErrorMsg('Please enter at least 10 characters.')
      return
    }

    setState('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          description: description.trim(),
          metadata: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            version,
            commit,
            env,
          },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send feedback')
      }

      setState('success')
      timerRef.current = setTimeout(() => {
        handleClose()
      }, 2000)
    } catch (err) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Send Feedback"
      maxWidth="max-w-md"
      showFooterClose={false}
    >
      {state === 'success' ? (
        <div className="py-6 text-center text-sm text-text-muted">
          Thanks for your feedback!
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <SegmentedControl<Category>
            ariaLabel="Feedback category"
            value={category}
            options={categoryOptions}
            onChange={setCategory}
            className="w-full [&>button]:flex-1"
          />

          <textarea
            id="feedback-description"
            aria-label="Feedback description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={category === 'bug' ? 'What happened? What did you expect?' : 'What would you like to see improved?'}
            rows={4}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
            disabled={state === 'submitting'}
          />

          {errorMsg && (
            <p className="text-sm text-danger">{errorMsg}</p>
          )}

          <Button
            type="submit"
            fullWidth
            loading={state === 'submitting'}
          >
            {state === 'submitting' ? 'Sending' : 'Send Feedback'}
          </Button>
        </form>
      )}
    </ContentDialog>
  )
}
