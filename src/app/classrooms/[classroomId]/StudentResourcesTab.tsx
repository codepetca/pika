'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { PageContent, PageLayout } from '@/components/PageLayout'
import type { Classroom, TiptapContent } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentResourcesTab({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent | null>(null)

  useEffect(() => {
    async function loadResources() {
      setLoading(true)
      try {
        const res = await fetch(`/api/student/classrooms/${classroom.id}/resources`)
        const data = await res.json()
        setContent(data.resources?.content || null)
      } catch (err) {
        console.error('Error loading resources:', err)
      } finally {
        setLoading(false)
      }
    }
    loadResources()
  }, [classroom.id])

  if (loading) {
    return (
      <PageLayout>
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner />
          </div>
        </PageContent>
      </PageLayout>
    )
  }

  const hasContent = content && content.content && content.content.length > 0

  return (
    <PageLayout>
      <PageContent>
        <div className="bg-surface rounded-lg shadow-sm p-6">
          {hasContent ? (
            <RichTextViewer content={content} />
          ) : (
            <div className="text-center py-12">
              <p className="text-text-muted">No resources have been added yet.</p>
            </div>
          )}
        </div>
      </PageContent>
    </PageLayout>
  )
}
