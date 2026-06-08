'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import type { Classroom, TiptapContent } from '@/types'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import { isEmpty } from '@/lib/tiptap-content'
import { fetchStudentClassResources } from '@/lib/class-resources-client'

interface Props {
  classroom: Classroom
}

export function StudentClassResourcesSidebar({ classroom }: Props) {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<TiptapContent | null>(null)
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const showLoadingSpinner = useDelayedBusy(loading)

  useEffect(() => {
    async function loadResources() {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      setLoading(true)
      try {
        const loadedContent = await fetchStudentClassResources(classroom.id)
        if (loadRequestIdRef.current !== requestId) return
        setContent(loadedContent)
        setLoadedClassroomId(classroom.id)
      } catch (err) {
        if (loadRequestIdRef.current !== requestId) return
        setContent(null)
        setLoadedClassroomId(classroom.id)
        console.error('Error loading resources:', err)
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    }

    loadResources()
  }, [classroom.id])

  const currentContent = loadedClassroomId === classroom.id ? content : null
  const hasContent = currentContent ? !isEmpty(currentContent) : false

  if (showLoadingSpinner) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="px-3 py-3">
      {hasContent ? (
        <div className="rounded-lg bg-surface p-4 shadow-sm">
          <RichTextViewer content={currentContent!} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-sm text-text-muted">No resources have been added yet.</p>
        </div>
      )}
    </div>
  )
}
