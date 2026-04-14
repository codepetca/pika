'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import type { Classroom, TiptapContent } from '@/types'
import { fetchJSONWithCache } from '@/lib/request-cache'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { isEmpty } from '@/lib/tiptap-content'

interface Props {
  classroom: Classroom
}

export function StudentClassResourcesSidebar({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent | null>(null)
  const showLoadingSpinner = useDelayedBusy(loading)

  useEffect(() => {
    async function loadResources() {
      setLoading(true)
      try {
        const data = await fetchJSONWithCache(
          `student-resources:${classroom.id}`,
          async () => {
            const res = await fetch(`/api/student/classrooms/${classroom.id}/resources`)
            if (!res.ok) throw new Error('Failed to load resources')
            return res.json()
          },
          20_000,
        )
        setContent(data.resources?.content || null)
      } catch (err) {
        console.error('Error loading resources:', err)
      } finally {
        setLoading(false)
      }
    }

    loadResources()
  }, [classroom.id])

  const hasContent = content ? !isEmpty(content) : false

  if (showLoadingSpinner) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="rounded-lg bg-surface p-6 shadow-sm">
        {hasContent ? (
          <RichTextViewer content={content!} />
        ) : (
          <div className="py-12 text-center">
            <p className="text-text-muted">No resources have been added yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
