/**
 * Re-export from ClassDaysContext for backward compatibility.
 * Components can use either:
 * - useClassDays(classroomId) - simple hook, works with or without provider
 * - useClassDaysContext() - full context with loading state and refresh
 */
export { useClassDays, useClassDaysContext, ClassDaysProvider } from '@/contexts/ClassDaysContext'
