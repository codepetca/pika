'use client'

import { useState } from 'react'
import { ContentDialog } from '@/ui/Dialog'

interface FeedbackDialogProps {
  isOpen: boolean
  onClose: () => void
}

type Category = 'bug' | 'suggestion'

export function FeedbackDialog({ isOpen, onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<Category>('bug')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const version = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown'
  const commit = (process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown').slice(0, 7)
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV || 'development'

  function handleClose() {
    if (state !== 'submitting') {
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
      setTimeout(() => {
        handleClose()
      }, 2000)
    } catch (err) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <ContentDialog isOpen={isOpen} onClose={handleClose} title="Send Feedback" maxWidth="max-w-md">
      {state === 'success' ? (
        <div className="py-6 text-center text-sm text-text-muted">
          Thanks for your feedback!
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category */}
          <fieldset>
            <legend className="text-sm font-medium text-text-default mb-2">Category</legend>
            <div className="flex gap-2">
              {(['bug', 'suggestion'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setCategory(opt)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    category === opt
                      ? 'border-border-strong bg-surface-2 text-text-default'
                      : 'border-border bg-surface text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {opt === 'bug' ? 'Bug report' : 'Suggestion'}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Description */}
          <div>
            <label htmlFor="feedback-description" className="block text-sm font-medium text-text-default mb-1">
              Description
            </label>
            <textarea
              id="feedback-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={category === 'bug' ? 'What happened? What did you expect?' : 'What would you like to see improved?'}
              rows={4}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={state === 'submitting'}
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}

          {/* Build info */}
          <div className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-muted space-y-0.5">
            <p>Version {version} · {commit} · {env}</p>
          </div>

          <button
            type="submit"
            disabled={state === 'submitting'}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {state === 'submitting' ? 'Sending…' : 'Send Feedback'}
          </button>
        </form>
      )}
    </ContentDialog>
  )
}
