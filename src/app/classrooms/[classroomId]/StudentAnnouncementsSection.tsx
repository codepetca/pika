'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/ui'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { Spinner } from '@/components/Spinner'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import type { Announcement, Classroom } from '@/types'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import { cn } from '@/ui/utils'
import { normalizeAnnouncementTitle, sortAnnouncementsNewestFirst } from '@/lib/announcements'

interface Props {
  classroom: Classroom
  className?: string
}

type AnnouncementsResponse = { announcements?: Announcement[] }

export function StudentAnnouncementsSection({ classroom, className }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const hasMarkedRead = useRef(false)
  const loadRequestIdRef = useRef(0)
  const notifications = useStudentNotifications()

  const loadAnnouncements = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    try {
      const data = await fetchCachedJSON<AnnouncementsResponse>(
        `student-announcements:${classroom.id}`,
        `/api/student/classrooms/${classroom.id}/announcements`,
        { ttlMs: 20_000, errorMessage: 'Failed to load announcements' },
      )
      if (loadRequestIdRef.current !== requestId) return
      setAnnouncements(data.announcements || [])
      setLoadedClassroomId(classroom.id)
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return
      setAnnouncements([])
      setLoadedClassroomId(classroom.id)
      console.error('Error loading announcements:', err)
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [classroom.id])

  useEffect(() => {
    hasMarkedRead.current = false
  }, [classroom.id])

  const markAllAsRead = useCallback(async () => {
    if (hasMarkedRead.current) return
    hasMarkedRead.current = true

    try {
      const res = await fetch(`/api/student/classrooms/${classroom.id}/announcements`, {
        method: 'POST',
      })
      if (res.ok) {
        invalidateCachedJSON(`student-announcements:${classroom.id}`)
        // Clear the notification count for this classroom
        notifications?.markAnnouncementsRead?.()
      }
    } catch (err) {
      console.error('Error marking announcements as read:', err)
    }
  }, [classroom.id, notifications])

  useEffect(() => {
    loadAnnouncements()
  }, [loadAnnouncements])

  const currentAnnouncements = loadedClassroomId === classroom.id ? announcements : []
  const isLoading = loading || loadedClassroomId !== classroom.id

  // Mark all as read when component mounts and announcements are loaded
  useEffect(() => {
    if (!isLoading && currentAnnouncements.length > 0) {
      markAllAsRead()
    }
  }, [isLoading, currentAnnouncements.length, markAllAsRead])

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return `${weekday} ${monthDay}, ${time}`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  if (currentAnnouncements.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface-2 p-4', className ?? 'max-w-2xl mx-auto')}>
        <p className="text-sm text-text-muted">No announcements yet.</p>
      </div>
    )
  }

  const sortedAnnouncements = sortAnnouncementsNewestFirst(currentAnnouncements)

  return (
    <div className={cn('space-y-3', className ?? 'max-w-2xl mx-auto')}>
      {(showAll ? sortedAnnouncements : sortedAnnouncements.slice(0, 5)).map((announcement) => {
        const title = normalizeAnnouncementTitle(announcement.title)

        return (
          <div
            key={announcement.id}
            className="bg-surface rounded-lg border border-border p-4"
          >
            <p className="text-[11px] text-text-muted mb-2">
              {formatDate(announcement.created_at)}
              {announcement.updated_at !== announcement.created_at && ' (edited)'}
            </p>
            {title && (
              <h3 className="mb-2 truncate text-sm font-semibold text-text-default">
                {title}
              </h3>
            )}
            <AnnouncementContent content={announcement.content} />
          </div>
        )
      })}

      {!showAll && currentAnnouncements.length > 5 && (
        <Button
          variant="secondary"
          onClick={() => setShowAll(true)}
          className="w-full"
        >
          Show {currentAnnouncements.length - 5} older announcement{currentAnnouncements.length - 5 === 1 ? '' : 's'}
        </Button>
      )}
    </div>
  )
}
