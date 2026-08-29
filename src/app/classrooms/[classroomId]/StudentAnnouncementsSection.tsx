'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Card, PageState, RefreshingIndicator } from '@/ui'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import type { Announcement, Classroom } from '@/types'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import { cn } from '@/ui'
import {
  formatAnnouncementTimestamp,
  normalizeAnnouncementTitle,
  sortAnnouncementsNewestFirst,
} from '@/lib/announcements'

interface Props {
  classroom: Classroom
  className?: string
}

type AnnouncementsResponse = { announcements?: Announcement[] }

export function StudentAnnouncementsSection({ classroom, className }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loadedClassroomId, setLoadedClassroomId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErrorClassroomId, setLoadErrorClassroomId] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [markingRead, setMarkingRead] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const hasMarkedRead = useRef(false)
  const markReadInFlightRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const markReadRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  const notifications = useStudentNotifications()
  const markAnnouncementsRead = notifications?.markAnnouncementsRead

  const loadAnnouncements = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setLoading(true)
    setLoadErrorClassroomId(null)
    try {
      const data = await fetchCachedJSON<AnnouncementsResponse>(
        `student-announcements:${classroom.id}`,
        `/api/student/classrooms/${classroom.id}/announcements`,
        { ttlMs: 20_000, errorMessage: 'Failed to load announcements' },
      )
      if (loadRequestIdRef.current !== requestId || currentClassroomIdRef.current !== classroom.id) return
      setAnnouncements(data.announcements || [])
      setLoadedClassroomId(classroom.id)
    } catch (err) {
      if (loadRequestIdRef.current !== requestId || currentClassroomIdRef.current !== classroom.id) return
      setLoadErrorClassroomId(classroom.id)
      console.error('Error loading announcements:', err)
    } finally {
      if (loadRequestIdRef.current === requestId && currentClassroomIdRef.current === classroom.id) {
        setLoading(false)
      }
    }
  }, [classroom.id])

  useLayoutEffect(() => {
    currentClassroomIdRef.current = classroom.id
    loadRequestIdRef.current += 1
    hasMarkedRead.current = false
    markReadInFlightRef.current = false
    markReadRequestIdRef.current += 1
    setReadError(null)
    setMarkingRead(false)
    setShowAll(false)
  }, [classroom.id])

  const markAllAsRead = useCallback(async () => {
    if (hasMarkedRead.current || markReadInFlightRef.current) return
    const classroomId = classroom.id
    const requestId = markReadRequestIdRef.current + 1
    markReadRequestIdRef.current = requestId
    markReadInFlightRef.current = true
    setMarkingRead(true)
    setReadError(null)

    try {
      const res = await fetch(`/api/student/classrooms/${classroomId}/announcements`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to mark announcements as read')
      if (markReadRequestIdRef.current !== requestId || currentClassroomIdRef.current !== classroomId) return

      hasMarkedRead.current = true
      invalidateCachedJSON(`student-announcements:${classroomId}`)
      markAnnouncementsRead?.()
    } catch (err) {
      if (markReadRequestIdRef.current !== requestId || currentClassroomIdRef.current !== classroomId) return
      setReadError('Announcements are visible, but Pika could not mark them as read.')
      console.error('Error marking announcements as read:', err)
    } finally {
      if (markReadRequestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        markReadInFlightRef.current = false
        setMarkingRead(false)
      }
    }
  }, [classroom.id, markAnnouncementsRead])

  useEffect(() => {
    loadAnnouncements()
  }, [loadAnnouncements])

  const currentAnnouncements = loadedClassroomId === classroom.id ? announcements : []
  const hasCurrentClassroomData = loadedClassroomId === classroom.id
  const loadError = loadErrorClassroomId === classroom.id
  const isInitialLoading = !hasCurrentClassroomData && !loadError

  // Mark all as read when component mounts and announcements are loaded
  useEffect(() => {
    if (!isInitialLoading && !loadError && currentAnnouncements.length > 0) {
      markAllAsRead()
    }
  }, [isInitialLoading, loadError, currentAnnouncements.length, markAllAsRead])

  function retryLoadAnnouncements() {
    invalidateCachedJSON(`student-announcements:${classroom.id}`)
    void loadAnnouncements()
  }

  if (isInitialLoading) {
    return <PageState kind="loading" title="Loading announcements" />
  }

  if (loadError && currentAnnouncements.length === 0) {
    return (
      <PageState
        kind="error"
        title="Announcements couldn't load"
        description="Pika couldn't load this classroom's announcements. Nothing was changed."
        action={<Button onClick={retryLoadAnnouncements}>Retry</Button>}
      />
    )
  }

  if (currentAnnouncements.length === 0) {
    return <PageState kind="empty" title="No announcements yet" />
  }

  const sortedAnnouncements = sortAnnouncementsNewestFirst(currentAnnouncements)

  return (
    <div className={cn('space-y-3', className ?? 'max-w-2xl mx-auto')}>
      {loading ? <RefreshingIndicator label="Refreshing announcements" /> : null}
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          <span>Pika could not refresh announcements. The last loaded announcements are still shown.</span>
          <Button variant="secondary" size="sm" onClick={retryLoadAnnouncements}>Retry</Button>
        </div>
      ) : null}
      {readError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          <span>{readError}</span>
          <Button variant="secondary" size="sm" onClick={() => void markAllAsRead()} disabled={markingRead}>
            {markingRead ? 'Retrying...' : 'Retry'}
          </Button>
        </div>
      ) : null}
      {(showAll ? sortedAnnouncements : sortedAnnouncements.slice(0, 5)).map((announcement) => {
        const title = normalizeAnnouncementTitle(announcement.title)

        return (
          <Card
            key={announcement.id}
            padding="sm"
          >
            <p className="text-[11px] text-text-muted mb-2">
              {formatAnnouncementTimestamp(announcement.created_at)}
              {announcement.updated_at !== announcement.created_at && ' (edited)'}
            </p>
            {title && (
              <h3 className="mb-2 truncate text-sm font-semibold text-text-default">
                {title}
              </h3>
            )}
            <AnnouncementContent content={announcement.content} />
          </Card>
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
