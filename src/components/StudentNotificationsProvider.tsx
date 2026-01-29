'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type NotificationState = {
  hasTodayEntry: boolean
  unviewedAssignmentsCount: number
  activeQuizzesCount: number
  loading: boolean
  refresh: () => Promise<void>
  markTodayComplete: () => void
  decrementUnviewedCount: () => void
  clearActiveQuizzesCount: () => void
}

const NotificationsContext = createContext<NotificationState | null>(null)

export function StudentNotificationsProvider({
  classroomId,
  children,
}: {
  classroomId: string
  children: ReactNode
}) {
  const [hasTodayEntry, setHasTodayEntry] = useState(true) // Assume complete to avoid flash
  const [unviewedAssignmentsCount, setUnviewedAssignmentsCount] = useState(0)
  const [activeQuizzesCount, setActiveQuizzesCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/student/notifications?classroom_id=${classroomId}`)
      if (!res.ok) {
        console.error('Failed to fetch notifications:', res.status)
        return
      }
      const data = await res.json()
      setHasTodayEntry(data.hasTodayEntry)
      setUnviewedAssignmentsCount(data.unviewedAssignmentsCount)
      setActiveQuizzesCount(data.activeQuizzesCount ?? 0)
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }, [classroomId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Refresh notifications when window regains focus (handles tab switches, etc.)
  useEffect(() => {
    const onFocus = () => {
      fetchNotifications()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchNotifications])

  const refresh = useCallback(async () => {
    setLoading(true)
    await fetchNotifications()
  }, [fetchNotifications])

  const markTodayComplete = useCallback(() => {
    setHasTodayEntry(true)
  }, [])

  const decrementUnviewedCount = useCallback(() => {
    setUnviewedAssignmentsCount((prev) => Math.max(0, prev - 1))
  }, [])

  const clearActiveQuizzesCount = useCallback(() => {
    setActiveQuizzesCount(0)
  }, [])

  const value = useMemo<NotificationState>(
    () => ({
      hasTodayEntry,
      unviewedAssignmentsCount,
      activeQuizzesCount,
      loading,
      refresh,
      markTodayComplete,
      decrementUnviewedCount,
      clearActiveQuizzesCount,
    }),
    [hasTodayEntry, unviewedAssignmentsCount, activeQuizzesCount, loading, refresh, markTodayComplete, decrementUnviewedCount, clearActiveQuizzesCount]
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
