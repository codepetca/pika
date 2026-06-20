'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type NotificationState = {
  hasTodayEntry: boolean
  unviewedAssignmentsCount: number
  activeTestsCount: number
  unreadAnnouncementsCount: number
  loading: boolean
  refresh: () => Promise<void>
  markTodayComplete: () => void
  decrementUnviewedCount: () => void
  decrementActiveTestsCount: () => void
  markAnnouncementsRead: () => void
}

const NotificationsContext = createContext<NotificationState | null>(null)
const NOTIFICATIONS_CACHE_TTL_MS = 15_000

type StudentNotificationsResponse = {
  hasTodayEntry: boolean
  unviewedAssignmentsCount: number
  activeTestsCount?: number
  unreadAnnouncementsCount?: number
}

function getStudentNotificationsCacheKey(classroomId: string): string {
  return `student-notifications:${classroomId}`
}

export function StudentNotificationsProvider({
  classroomId,
  children,
}: {
  classroomId: string
  children: ReactNode
}) {
  const [hasTodayEntry, setHasTodayEntry] = useState(true) // Assume complete to avoid flash
  const [unviewedAssignmentsCount, setUnviewedAssignmentsCount] = useState(0)
  const [activeTestsCount, setActiveTestsCount] = useState(0)
  const [unreadAnnouncementsCount, setUnreadAnnouncementsCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const lastFetchRef = useRef(0)
  const FOCUS_COOLDOWN_MS = 30_000

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await fetchJSONWithCache<StudentNotificationsResponse>(
        getStudentNotificationsCacheKey(classroomId),
        async () => {
          const res = await fetch(`/api/student/notifications?classroom_id=${classroomId}`)
          if (!res.ok) {
            console.error('Failed to fetch notifications:', res.status)
            throw new Error('Failed to fetch notifications')
          }
          return res.json()
        },
        NOTIFICATIONS_CACHE_TTL_MS,
      )
      setHasTodayEntry(data.hasTodayEntry)
      setUnviewedAssignmentsCount(data.unviewedAssignmentsCount)
      setActiveTestsCount(data.activeTestsCount ?? 0)
      setUnreadAnnouncementsCount(data.unreadAnnouncementsCount ?? 0)
      lastFetchRef.current = Date.now()
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }, [classroomId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Refresh notifications when window regains focus, with cooldown
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current < FOCUS_COOLDOWN_MS) return
      fetchNotifications()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchNotifications, FOCUS_COOLDOWN_MS])

  const invalidateNotificationsCache = useCallback(() => {
    invalidateCachedJSON(getStudentNotificationsCacheKey(classroomId))
  }, [classroomId])

  const refresh = useCallback(async () => {
    invalidateNotificationsCache()
    setLoading(true)
    await fetchNotifications()
  }, [fetchNotifications, invalidateNotificationsCache])

  const markTodayComplete = useCallback(() => {
    invalidateNotificationsCache()
    setHasTodayEntry(true)
  }, [invalidateNotificationsCache])

  const decrementUnviewedCount = useCallback(() => {
    invalidateNotificationsCache()
    setUnviewedAssignmentsCount((prev) => Math.max(0, prev - 1))
  }, [invalidateNotificationsCache])

  const decrementActiveTestsCount = useCallback(() => {
    invalidateNotificationsCache()
    setActiveTestsCount((prev) => Math.max(0, prev - 1))
  }, [invalidateNotificationsCache])

  const markAnnouncementsRead = useCallback(() => {
    invalidateNotificationsCache()
    setUnreadAnnouncementsCount(0)
  }, [invalidateNotificationsCache])

  const value = useMemo<NotificationState>(
    () => ({
      hasTodayEntry,
      unviewedAssignmentsCount,
      activeTestsCount,
      unreadAnnouncementsCount,
      loading,
      refresh,
      markTodayComplete,
      decrementUnviewedCount,
      decrementActiveTestsCount,
      markAnnouncementsRead,
    }),
    [
      hasTodayEntry,
      unviewedAssignmentsCount,
      activeTestsCount,
      unreadAnnouncementsCount,
      loading,
      refresh,
      markTodayComplete,
      decrementUnviewedCount,
      decrementActiveTestsCount,
      markAnnouncementsRead,
    ]
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useStudentNotifications() {
  return useContext(NotificationsContext)
}
