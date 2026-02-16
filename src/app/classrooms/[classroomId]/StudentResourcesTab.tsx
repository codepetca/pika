'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextViewer } from '@/components/editor'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { StudentAnnouncementsSection } from './StudentAnnouncementsSection'
import type { Classroom, TiptapContent } from '@/types'

type ResourcesSection = 'announcements' | 'class-resources'

interface Props {
  classroom: Classroom
  sectionParam?: string | null
  onSectionChange?: (section: ResourcesSection) => void
}

export function StudentResourcesTab({
  classroom,
  sectionParam,
  onSectionChange = () => {},
}: Props) {
  const section: ResourcesSection = sectionParam === 'class-resources' ? 'class-resources' : 'announcements'

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

  const hasContent = content && content.content && content.content.length > 0

  return (
    <PageLayout>
      {/* Sub-tab navigation */}
      <div className="flex border-b border-border mb-4">
        <button
          type="button"
          onClick={() => onSectionChange('announcements')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'announcements'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          Announcements
        </button>
        <button
          type="button"
          onClick={() => onSectionChange('class-resources')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            section === 'class-resources'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted hover:text-text-default hover:border-border'
          }`}
        >
          Class Resources
        </button>
      </div>

      {section === 'announcements' ? (
        <PageContent>
          <StudentAnnouncementsSection classroom={classroom} />
        </PageContent>
      ) : (
        <PageContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner />
            </div>
          ) : (
            <div className="bg-surface rounded-lg shadow-sm p-6">
              {hasContent ? (
                <RichTextViewer content={content} />
              ) : (
                <div className="text-center py-12">
                  <p className="text-text-muted">No resources have been added yet.</p>
                </div>
              )}
            </div>
          )}
        </PageContent>
      )}
    </PageLayout>
  )
}
