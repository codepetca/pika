'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import type { Announcement, Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentAnnouncementsSection({ classroom }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const hasMarkedRead = useRef(false)
  const notifications = useStudentNotifications()

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await fetch(`/api/student/classrooms/${classroom.id}/announcements`)
      if (!res.ok) throw new Error('Failed to load announcements')
      const data = await res.json()
      setAnnouncements(data.announcements || [])
    } catch (err) {
      console.error('Error loading announcements:', err)
    } finally {
      setLoading(false)
    }
  }, [classroom.id])

  const markAllAsRead = useCallback(async () => {
    if (hasMarkedRead.current) return
    hasMarkedRead.current = true

    try {
      const res = await fetch(`/api/student/classrooms/${classroom.id}/announcements`, {
        method: 'POST',
      })
      if (res.ok) {
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

  // Mark all as read when component mounts and announcements are loaded
  useEffect(() => {
    if (!loading && announcements.length > 0) {
      markAllAsRead()
    }
  }, [loading, announcements.length, markAllAsRead])

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    )
  }

  if (announcements.length === 0) {
    return (
      <div className="bg-surface rounded-lg border border-border p-8 text-center">
        <p className="text-text-muted">No announcements yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {announcements.map((announcement) => (
        <div
          key={announcement.id}
          className="bg-surface rounded-lg border border-border p-4"
        >
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-text-default">
              {announcement.title}
            </h4>
            <p className="text-xs text-text-muted mt-0.5">
              {formatDate(announcement.created_at)}
              {announcement.updated_at !== announcement.created_at && ' (edited)'}
            </p>
          </div>
          <p className="mt-3 text-sm text-text-default whitespace-pre-wrap">
            {announcement.content}
          </p>
        </div>
      ))}
    </div>
  )
}
