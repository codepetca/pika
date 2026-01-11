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
  loading: boolean
  refresh: () => Promise<void>
  markTodayComplete: () => void
  decrementUnviewedCount: () => void
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
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }, [classroomId])

  useEffect(() => {
    fetchNotifications()
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

  const value = useMemo<NotificationState>(
    () => ({
      hasTodayEntry,
      unviewedAssignmentsCount,
      loading,
      refresh,
      markTodayComplete,
      decrementUnviewedCount,
    }),
    [hasTodayEntry, unviewedAssignmentsCount, loading, refresh, markTodayComplete, decrementUnviewedCount]
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
