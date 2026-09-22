'use client'

import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { Button, PageState, SaveStatus } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import { PageContent, PageLayout, PageStack } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { isClassDayOnDate } from '@/lib/class-days'
import { useClassDaysContext } from '@/hooks/useClassDays'
import { StudentPastLogs } from './StudentPastLogs'
import {
  safeSessionGetJson,
  safeSessionRemove,
  safeSessionSetJson,
} from '@/lib/client-storage'
import {
  getStudentEntryHistoryCacheKey,
  upsertEntryIntoHistory,
} from '@/lib/student-entry-history'
import { fetchJSONWithCache } from '@/lib/request-cache'
import {
  fetchStudentEntriesForClassroom,
  invalidateStudentEntriesForClassroom,
} from '@/lib/student-entries-client'
import {
  redirectToLoginForReauth,
  SESSION_EXPIRED_MESSAGE,
} from '@/lib/client-auth'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { countCharacters, extractPlainText, isEmpty, plainTextToTiptapContent } from '@/lib/tiptap-content'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { notifyImmediatePalDelivery } from '@/lib/pal-browser-events'
import {
  listDailyLogDrafts,
  readDailyLogDraft,
  removeDailyLogDraft,
  writeDailyLogDraft,
  type DailyLogDraft,
} from '@/lib/daily-log-drafts'
import { useTorontoToday } from '@/hooks/use-toronto-today'
import type { Classroom, Entry, JsonPatchOperation, LessonPlan, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }

function getDailyLogDraftKey(classroomId: string, date: string): string {
  return `daily-log-draft:${classroomId}:${date}`
}

function parseSavedContent(contentString: string | null): TiptapContent {
  if (!contentString) return EMPTY_DOC
  try {
    return JSON.parse(contentString) as TiptapContent
  } catch {
    return EMPTY_DOC
  }
}

function resolveEntryContent(entry: Entry | null): TiptapContent {
  if (entry?.rich_content) {
    return entry.rich_content
  }
  if (entry?.text) {
    return plainTextToTiptapContent(entry.text)
  }
  return EMPTY_DOC
}

const DAILY_LOG_TITLE = 'Daily Log'


interface StudentTodayTabProps {
  classroom: Classroom
  studentId: string
  layout?: 'page' | 'pane'
  mobilePlan?: ReactNode
  onLessonPlanLoad?: (plan: LessonPlan | null, classroomId: string) => void
  onLessonPlanLoading?: (classroomId: string) => void
  onLessonPlanError?: (classroomId: string) => void
  lessonPlanRequestVersion?: number
}

export function StudentTodayTab({
  classroom,
  studentId,
  layout = 'page',
  mobilePlan,
  onLessonPlanLoad,
  onLessonPlanLoading,
  onLessonPlanError,
  lessonPlanRequestVersion = 0,
}: StudentTodayTabProps) {
  const scheduledTorontoDate = useTorontoToday()
  const [currentTorontoDate, setCurrentTorontoDate] = useState(scheduledTorontoDate)
  const notifications = useStudentNotifications()

  useEffect(() => {
    setCurrentTorontoDate(scheduledTorontoDate)
  }, [scheduledTorontoDate])
  const {
    classDays,
    error: classDaysError,
    hasLoadedSnapshot: hasClassDaysSnapshot,
    isLoading: classDaysLoading,
    refresh: refreshClassDays,
  } = useClassDaysContext()

  // Constants
  const pastHistoryLimit = 10
  const historyLimit = pastHistoryLimit + 1
  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000
  const MAX_CHARS = 2000

  // State
  const [loading, setLoading] = useState(true)
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [entriesRequestVersion, setEntriesRequestVersion] = useState(0)
  const [entriesSnapshotClassroomId, setEntriesSnapshotClassroomId] = useState<string | null>(null)
  const [today, setToday] = useState('')
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [historyEntries, setHistoryEntries] = useState<Entry[]>([])
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [saveError, setSaveError] = useState('')
  const [draftStorageUnavailable, setDraftStorageUnavailable] = useState(false)
  const [conflictEntry, setConflictEntry] = useState<Entry | null>(null)
  const [olderDrafts, setOlderDrafts] = useState<DailyLogDraft[]>([])
  const [olderDraftError, setOlderDraftError] = useState<Record<string, string>>({})
  const [olderConflicts, setOlderConflicts] = useState<Record<string, Entry>>({})
  const [olderDraftSavingDate, setOlderDraftSavingDate] = useState<string | null>(null)

  // Refs for autosave
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const saveQueuesByDateRef = useRef(new Map<string, Promise<void>>())
  const queuedContentByDateRef = useRef(new Map<string, string>())
  const saveInFlightDatesRef = useRef(new Set<string>())
  const initialSaveRequestedRef = useRef(false)
  const olderDraftAttemptsRef = useRef(new Set<string>())
  const pendingContentRef = useRef<TiptapContent | null>(null)
  const restoredDraftAutosaveRef = useRef<TiptapContent | null>(null)
  const currentContentRef = useRef<TiptapContent>(EMPTY_DOC)
  const entryIdRef = useRef<string | null>(null)
  const entryVersionRef = useRef(1)
  const todayRef = useRef('')
  const hasLocalEditSinceLoadRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroom.id)
  const entriesSnapshotClassroomIdRef = useRef<string | null>(null)
  const entriesSnapshotDateRef = useRef<string | null>(null)
  currentClassroomIdRef.current = classroom.id

  useEffect(() => {
    async function load() {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      const requestedClassroomId = classroom.id
      const todayDate = currentTorontoDate
      setOlderDrafts(listDailyLogDrafts(studentId, requestedClassroomId, todayDate))
      const hasCurrentSnapshot = (
        entriesSnapshotClassroomIdRef.current === requestedClassroomId &&
        entriesSnapshotDateRef.current === todayDate
      )
      const isCurrentLoad = () => (
        loadRequestIdRef.current === requestId &&
        currentClassroomIdRef.current === requestedClassroomId
      )

      setEntriesError(null)
      if (!hasCurrentSnapshot) {
        setLoading(true)
        setHistoryEntries([])
        setEntriesSnapshotClassroomId(null)
        setToday(todayDate)
        setContent(EMPTY_DOC)
        currentContentRef.current = EMPTY_DOC
        pendingContentRef.current = null
        restoredDraftAutosaveRef.current = null
        hasLocalEditSinceLoadRef.current = false
        lastSavedContentRef.current = JSON.stringify(EMPTY_DOC)
        entryIdRef.current = null
        entryVersionRef.current = 1
        initialSaveRequestedRef.current = false
        setSaveStatus('saved')
        setSaveError('')
        setDraftStorageUnavailable(false)
        setConflictEntry(null)
      }
      try {
        todayRef.current = todayDate
        setToday(todayDate)
        const relevantHistoryDates = new Set([
          todayDate,
          ...classDays
            .filter(day => day.is_class_day && day.date < todayDate)
            .sort((left, right) => right.date.localeCompare(left.date))
            .slice(0, pastHistoryLimit)
            .map(day => day.date),
        ])
        const selectRelevantEntries = (entries: Entry[]) => (
          entries.filter(entry => relevantHistoryDates.has(entry.date))
        )

        const historyCacheKey = getStudentEntryHistoryCacheKey({
          classroomId: classroom.id,
          limit: historyLimit,
        })
        const cached = safeSessionGetJson<Entry[]>(historyCacheKey)

        // Fetch today's lesson plan (class days come from context)
        onLessonPlanLoading?.(requestedClassroomId)
        const lessonPlanPromise = fetchJSONWithCache<{ lesson_plans?: LessonPlan[]; lessonPlans?: LessonPlan[] }>(
          `student-lesson-plans:${classroom.id}:${todayDate}:${todayDate}`,
          async () => {
            const response = await fetch(
              `/api/student/classrooms/${classroom.id}/lesson-plans?start=${todayDate}&end=${todayDate}`
            )
            const data = await response.json().catch(() => ({ lesson_plans: [] }))
            if (!response.ok) {
              throw new Error(
                typeof data.error === 'string' ? data.error : 'Failed to load lesson plan'
              )
            }
            return data
          },
          20_000,
        )
          .then(data => {
            if (!isCurrentLoad()) return
            const plans = data.lesson_plans || data.lessonPlans || []
            const todayPlan = plans.find((p: LessonPlan) => p.date === todayDate) || null
            onLessonPlanLoad?.(todayPlan, requestedClassroomId)
          })
          .catch(err => {
            if (!isCurrentLoad()) return
            console.error('Error loading lesson plan:', err)
            onLessonPlanError?.(requestedClassroomId)
          })

        const applyEntryState = (todayEntry: Entry | null) => {
          if (!isCurrentLoad()) return

          const loadedContent = resolveEntryContent(todayEntry)
          const durableDraft = readDailyLogDraft(studentId, requestedClassroomId, todayDate)
          const draftContent = durableDraft?.content
          if (
            draftContent &&
            (todayEntry || !isEmpty(draftContent)) &&
            JSON.stringify(draftContent) !== JSON.stringify(loadedContent)
          ) {
            setContent(draftContent)
            currentContentRef.current = draftContent
            pendingContentRef.current = draftContent
            restoredDraftAutosaveRef.current = draftContent
            hasLocalEditSinceLoadRef.current = true
            setSaveStatus('unsaved')
            if (durableDraft && todayEntry && (
              durableDraft.entryId !== todayEntry.id || durableDraft.version !== (todayEntry.version ?? 1)
            )) {
              restoredDraftAutosaveRef.current = null
              setConflictEntry(todayEntry)
              setSaveError('This log changed elsewhere. Review before replacing the newer version.')
            }
          }

          if (!draftContent || (!todayEntry && isEmpty(draftContent)) || JSON.stringify(draftContent) === JSON.stringify(loadedContent)) {
            setContent(loadedContent)
            currentContentRef.current = loadedContent
            pendingContentRef.current = null
            hasLocalEditSinceLoadRef.current = false
            setSaveStatus('saved')
            if (durableDraft) removeDailyLogDraft(studentId, requestedClassroomId, todayDate)
          }

          lastSavedContentRef.current = JSON.stringify(loadedContent)
          if (!durableDraft || !todayEntry || (
            durableDraft.entryId === todayEntry.id && durableDraft.version === (todayEntry.version ?? 1)
          )) {
            setSaveError('')
            setConflictEntry(null)
          }
          entryIdRef.current = todayEntry?.id ?? null
          entryVersionRef.current = todayEntry?.version ?? 1
          initialSaveRequestedRef.current = Boolean(todayEntry && !isEmpty(loadedContent))
        }

        if (Array.isArray(cached)) {
          if (!isCurrentLoad()) return
          const relevantCachedEntries = selectRelevantEntries(cached)
          setHistoryEntries(relevantCachedEntries)
          const todayEntry = relevantCachedEntries.find((e: Entry) => e.date === todayDate) || null
          applyEntryState(todayEntry)
          entriesSnapshotClassroomIdRef.current = requestedClassroomId
          entriesSnapshotDateRef.current = todayDate
          setEntriesSnapshotClassroomId(requestedClassroomId)
          setLoading(false)
        }

        const entriesPromise = fetchStudentEntriesForClassroom(requestedClassroomId)
          .then(entries => {
            if (!isCurrentLoad()) return
            const relevantEntries = selectRelevantEntries(entries)
            entriesSnapshotClassroomIdRef.current = requestedClassroomId
            entriesSnapshotDateRef.current = todayDate
            setEntriesSnapshotClassroomId(requestedClassroomId)
            if (hasLocalEditSinceLoadRef.current) {
              setHistoryEntries(prev => {
                if (!isCurrentLoad()) return prev
                const currentTodayEntry = prev.find((e: Entry) => e.date === todayDate) || null
                const next = currentTodayEntry
                  ? upsertEntryIntoHistory(relevantEntries, currentTodayEntry, historyLimit)
                  : relevantEntries
                safeSessionSetJson(historyCacheKey, next)
                return next
              })
              return
            }
            setHistoryEntries(relevantEntries)
            safeSessionSetJson(historyCacheKey, relevantEntries)
            const todayEntry = relevantEntries.find((e: Entry) => e.date === todayDate) || null
            applyEntryState(todayEntry)
          })

        await Promise.all([entriesPromise, lessonPlanPromise])
      } catch (err) {
        if (!isCurrentLoad()) return
        console.error('Error loading today tab:', err)
        setEntriesError('The daily log could not be loaded.')
      } finally {
        if (loadRequestIdRef.current === requestId && currentClassroomIdRef.current === requestedClassroomId) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      loadRequestIdRef.current += 1
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
      }
    }
  }, [classDays, classroom.id, currentTorontoDate, entriesRequestVersion, historyLimit, lessonPlanRequestVersion, onLessonPlanError, onLessonPlanLoad, onLessonPlanLoading, pastHistoryLimit, studentId])

  const retryEntries = useCallback(() => {
    invalidateStudentEntriesForClassroom(classroom.id)
    setEntriesError(null)
    if (entriesSnapshotClassroomIdRef.current !== classroom.id) {
      setLoading(true)
    }
    setEntriesRequestVersion((version) => version + 1)
  }, [classroom.id])

  const updateHistoryEntries = useCallback((entry: Entry) => {
    setHistoryEntries(prev => {
      const next = upsertEntryIntoHistory(prev, entry, historyLimit)
      safeSessionSetJson(
        getStudentEntryHistoryCacheKey({
          classroomId: classroom.id,
          limit: historyLimit,
        }),
        next
      )
      return next
    })
  }, [classroom.id, historyLimit])

  const saveContent = useCallback(async (
    newContent: TiptapContent,
    entryDate: string,
    options?: { forceFull?: boolean }
  ) => {
    const actualTorontoDate = getTodayInToronto()
    if (actualTorontoDate !== todayRef.current) {
      setCurrentTorontoDate(actualTorontoDate)
    }
    if (!entryDate) return
    const isActiveEntry = () => (
      currentClassroomIdRef.current === classroom.id && todayRef.current === entryDate
    )
    const activeAtStart = isActiveEntry()
    const storedDraft = readDailyLogDraft(studentId, classroom.id, entryDate)
    const entryId = activeAtStart ? entryIdRef.current : storedDraft?.entryId ?? null
    const entryVersion = activeAtStart ? entryVersionRef.current : storedDraft?.version ?? 1
    const savedContent = activeAtStart ? lastSavedContentRef.current : ''

    // Don't create a new DB record for empty content (e.g. TipTap mount normalization)
    const newContentStr = JSON.stringify(newContent)
    const draftKey = getDailyLogDraftKey(classroom.id, entryDate)

    if (!entryId && isEmpty(newContent)) {
      if (!activeAtStart) {
        try {
          invalidateStudentEntriesForClassroom(classroom.id)
          const entries = await fetchStudentEntriesForClassroom(classroom.id)
          const existingOnDate = entries.find(entry => entry.date === entryDate)
          if (existingOnDate) {
            if (storedDraft) writeDailyLogDraft({
              ...storedDraft,
              entryId: existingOnDate.id,
              version: existingOnDate.version ?? 1,
            })
            await saveContent(newContent, entryDate, { forceFull: true })
            return
          }
        } catch (error) {
          setOlderDraftError(prev => ({ ...prev, [entryDate]: 'Could not check the saved log. Retry when connected.' }))
          return
        }
      }
      if (activeAtStart) lastSavedContentRef.current = newContentStr
      safeSessionRemove(draftKey)
      removeDailyLogDraft(studentId, classroom.id, entryDate)
      if (activeAtStart) setSaveStatus('saved')
      return
    }

    if (!options?.forceFull && newContentStr === savedContent) {
      safeSessionRemove(draftKey)
      removeDailyLogDraft(studentId, classroom.id, entryDate)
      if (activeAtStart) setSaveStatus('saved')
      return
    }

    if (countCharacters(newContent) > MAX_CHARS) {
      if (activeAtStart) {
        setSaveError(`Entry exceeds ${MAX_CHARS} character limit`)
        setSaveStatus('unsaved')
      }
      if (!activeAtStart) setOlderDraftError(prev => ({ ...prev, [entryDate]: `Entry exceeds ${MAX_CHARS} character limit` }))
      return
    }

    if (activeAtStart) {
      setSaveStatus('saving')
      setSaveError('')
    }
    else setOlderDraftSavingDate(entryDate)
    safeSessionSetJson(draftKey, newContent)
    lastSaveAttemptAtRef.current = Date.now()

    const baseContent = parseSavedContent(savedContent)
    const patch = createJsonPatch(baseContent, newContent)
    const shouldSendPatch =
      !options?.forceFull &&
      entryId &&
      patch.length > 0 &&
      !shouldStoreSnapshot(patch, newContent)

    const payload: {
      classroom_id: string
      date: string
      entry_id?: string
      version: number
      rich_content?: TiptapContent
      patch?: JsonPatchOperation[]
    } = {
      classroom_id: classroom.id,
      date: entryDate,
      entry_id: entryId ?? undefined,
      version: entryVersion,
    }

    if (shouldSendPatch) {
      payload.patch = patch
    } else {
      payload.rich_content = newContent
    }

    try {
      const response = await fetch('/api/student/entries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (response.status === 401) {
        if (isActiveEntry()) {
          setSaveStatus('unsaved')
          setSaveError(SESSION_EXPIRED_MESSAGE)
        }
        else setOlderDraftError(prev => ({ ...prev, [entryDate]: SESSION_EXPIRED_MESSAGE }))
        redirectToLoginForReauth()
        return
      }

      if (response.status === 409) {
        const serverEntry = data.entry as Entry | undefined
        if (serverEntry) {
          if (isActiveEntry()) setConflictEntry(serverEntry)
          else setOlderConflicts(prev => ({ ...prev, [entryDate]: serverEntry }))
          if (serverEntry.date) {
            updateHistoryEntries(serverEntry)
          } else {
            safeSessionRemove(
              getStudentEntryHistoryCacheKey({
                classroomId: classroom.id,
                limit: historyLimit,
              })
            )
          }
        } else {
          safeSessionRemove(
            getStudentEntryHistoryCacheKey({
              classroomId: classroom.id,
              limit: historyLimit,
            })
          )
        }
        invalidateStudentEntriesForClassroom(classroom.id)
        if (isActiveEntry()) {
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
          if (throttledSaveTimeoutRef.current) {
            clearTimeout(throttledSaveTimeoutRef.current)
            throttledSaveTimeoutRef.current = null
          }
          setSaveStatus('unsaved')
          setSaveError(data.error || 'Entry updated elsewhere')
        }
        else setOlderDraftError(prev => ({ ...prev, [entryDate]: 'A saved log already exists for this date. Your draft is still on this device.' }))
        return
      }

      if (response.status === 404 && shouldSendPatch) {
        await saveContent(newContent, entryDate, { forceFull: true })
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      notifyImmediatePalDelivery(data.pal_delivery, classroom.id)

      const savedEntry = data.entry as Entry
      const savedContentStillCurrent = isActiveEntry() && JSON.stringify(currentContentRef.current) === newContentStr
      const savedEntryContent = resolveEntryContent(savedEntry)

      if (isActiveEntry()) {
        entryIdRef.current = savedEntry.id
        entryVersionRef.current = savedEntry.version ?? entryVersionRef.current
      }

      invalidateStudentEntriesForClassroom(classroom.id)
      if (currentClassroomIdRef.current === classroom.id) updateHistoryEntries(savedEntry)
      if (isActiveEntry()) lastSavedContentRef.current = JSON.stringify(savedEntryContent)
      const latestDraft = readDailyLogDraft(studentId, classroom.id, entryDate)
      if (latestDraft && JSON.stringify(latestDraft.content) === newContentStr) {
        removeDailyLogDraft(studentId, classroom.id, entryDate)
      } else if (latestDraft) {
        writeDailyLogDraft({
          ...latestDraft,
          entryId: savedEntry.id,
          version: savedEntry.version ?? entryVersion,
        })
      }
      if (savedContentStillCurrent) {
        safeSessionRemove(draftKey)
        pendingContentRef.current = null
        restoredDraftAutosaveRef.current = null
        hasLocalEditSinceLoadRef.current = false
        setSaveStatus('saved')
        setSaveError('')
        setDraftStorageUnavailable(false)
        setConflictEntry(null)
        notifications?.markTodayComplete()
      } else if (isActiveEntry()) {
        setSaveStatus('unsaved')
      }
      if (currentClassroomIdRef.current === classroom.id) {
        setOlderDrafts(listDailyLogDrafts(studentId, classroom.id, getTodayInToronto()))
      }
      setOlderDraftError(prev => {
        const next = { ...prev }
        delete next[entryDate]
        return next
      })
      setOlderConflicts(prev => {
        const next = { ...prev }
        delete next[entryDate]
        return next
      })
    } catch (err: any) {
      console.error('Error saving:', err)
      if (isActiveEntry()) {
        setSaveStatus('unsaved')
        setSaveError(err.message || 'Failed to save')
        if (!entryId) initialSaveRequestedRef.current = false
      }
      else setOlderDraftError(prev => ({ ...prev, [entryDate]: err.message || 'Failed to save' }))
    } finally {
      setOlderDraftSavingDate(current => current === entryDate ? null : current)
    }
  }, [MAX_CHARS, classroom.id, historyLimit, updateHistoryEntries, notifications, studentId])

  const enqueueSave = useCallback((entryDate: string) => {
    const saveKey = `${studentId}:${classroom.id}:${entryDate}`
    const isCurrentEditor = () => currentClassroomIdRef.current === classroom.id && entryDate === todayRef.current
    const requestedContent = isCurrentEditor()
      ? pendingContentRef.current
      : readDailyLogDraft(studentId, classroom.id, entryDate)?.content
    if (!requestedContent) return
    const requestedContentStr = JSON.stringify(requestedContent)
    if (queuedContentByDateRef.current.get(saveKey) === requestedContentStr) return
    queuedContentByDateRef.current.set(saveKey, requestedContentStr)
    const previousSave = saveQueuesByDateRef.current.get(saveKey) ?? Promise.resolve()
    const nextSave = previousSave.catch(() => undefined).then(async () => {
      const latest = isCurrentEditor()
        ? pendingContentRef.current
        : readDailyLogDraft(studentId, classroom.id, entryDate)?.content
      if (!latest) {
        if (queuedContentByDateRef.current.get(saveKey) === requestedContentStr) {
          queuedContentByDateRef.current.delete(saveKey)
        }
        return
      }
      saveInFlightDatesRef.current.add(saveKey)
      try {
        await saveContent(latest, entryDate)
      } finally {
        saveInFlightDatesRef.current.delete(saveKey)
        if (queuedContentByDateRef.current.get(saveKey) === requestedContentStr) {
          queuedContentByDateRef.current.delete(saveKey)
        }
      }
    })
    saveQueuesByDateRef.current.set(saveKey, nextSave.catch(() => undefined))
  }, [classroom.id, saveContent, studentId])

  useEffect(() => {
    if (loading) return
    for (const draft of olderDrafts) {
      const attempt = `${draft.studentId}:${draft.classroomId}:${draft.date}:${draft.updatedAt}`
      if (olderDraftAttemptsRef.current.has(attempt)) continue
      olderDraftAttemptsRef.current.add(attempt)
      enqueueSave(draft.date)
    }
  }, [enqueueSave, loading, olderDrafts])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || !pendingContentRef.current || !todayRef.current) return
      enqueueSave(todayRef.current)
    }
    const handlePageHide = () => {
      const latest = pendingContentRef.current
      const date = todayRef.current
      if (!latest || !date || (!entryIdRef.current && isEmpty(latest))) return
      const body = JSON.stringify({
        classroom_id: classroom.id,
        date,
        entry_id: entryIdRef.current ?? undefined,
        version: entryVersionRef.current,
        rich_content: latest,
      })
      if (new TextEncoder().encode(body).byteLength > 60_000) return
      void fetch('/api/student/entries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [classroom.id, enqueueSave])

  const scheduleSave = useCallback((
    newContent: TiptapContent,
    options?: { force?: boolean }
  ) => {
    if (conflictEntry) return

    pendingContentRef.current = newContent

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastAttempt = now - lastSaveAttemptAtRef.current

    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      enqueueSave(todayRef.current)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingContentRef.current
      if (latest) {
        enqueueSave(todayRef.current)
      }
    }, waitMs)
  }, [AUTOSAVE_MIN_INTERVAL_MS, conflictEntry, enqueueSave])

  useEffect(() => {
    if (loading || conflictEntry) return

    const restoredDraft = restoredDraftAutosaveRef.current
    if (!restoredDraft) return

    restoredDraftAutosaveRef.current = null
    scheduleSave(restoredDraft, { force: true })
  }, [conflictEntry, loading, scheduleSave])

  function handleContentChange(newContent: TiptapContent) {
    const actualTorontoDate = getTodayInToronto()
    if (actualTorontoDate !== todayRef.current) {
      const previousText = extractPlainText(currentContentRef.current)
      const nextText = extractPlainText(newContent)
      let prefix = 0
      while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix += 1
      let suffix = 0
      while (suffix < previousText.length - prefix && suffix < nextText.length - prefix && previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix += 1
      const newlyTypedText = nextText.slice(prefix, nextText.length - suffix)
      if (newlyTypedText.trim()) {
        const newDayContent = plainTextToTiptapContent(newlyTypedText)
        writeDailyLogDraft({
          studentId,
          classroomId: classroom.id,
          date: actualTorontoDate,
          content: newDayContent,
          entryId: null,
          version: 1,
          updatedAt: new Date().toISOString(),
        })
      }
      setCurrentTorontoDate(actualTorontoDate)
      return
    }
    setContent(newContent)
    currentContentRef.current = newContent

    const newContentStr = JSON.stringify(newContent)
    const draftKey = todayRef.current
      ? getDailyLogDraftKey(classroom.id, todayRef.current)
      : null

    const saveKey = `${studentId}:${classroom.id}:${todayRef.current}`
    const hasOutstandingSave = saveInFlightDatesRef.current.has(saveKey) || queuedContentByDateRef.current.has(saveKey)
    if ((newContentStr === lastSavedContentRef.current && !hasOutstandingSave) || (!entryIdRef.current && isEmpty(newContent) && !hasOutstandingSave)) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
        throttledSaveTimeoutRef.current = null
      }
      lastSavedContentRef.current = newContentStr
      if (draftKey) {
        safeSessionRemove(draftKey)
        removeDailyLogDraft(studentId, classroom.id, todayRef.current)
      }
      pendingContentRef.current = null
      hasLocalEditSinceLoadRef.current = false
      setSaveStatus('saved')
      setSaveError('')
      return
    }

    hasLocalEditSinceLoadRef.current = true
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent
    if (draftKey) {
      const draftStored = writeDailyLogDraft({
        studentId,
        classroomId: classroom.id,
        date: todayRef.current,
        content: newContent,
        entryId: entryIdRef.current,
        version: entryVersionRef.current,
        updatedAt: new Date().toISOString(),
      })
      setDraftStorageUnavailable(!draftStored)
    }

    if (!conflictEntry) {
      const nextCharCount = countCharacters(newContent)
      setSaveError(
        nextCharCount > MAX_CHARS
          ? `Entry exceeds ${MAX_CHARS} character limit`
          : ''
      )
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    if (!initialSaveRequestedRef.current && !isEmpty(newContent)) {
      initialSaveRequestedRef.current = true
      scheduleSave(newContent, { force: true })
      return
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function flushAutosave() {
    if (conflictEntry) return
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      scheduleSave(pendingContentRef.current, { force: true })
    }
  }

  const resolveConflict = useCallback(() => {
    if (!conflictEntry) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    if (throttledSaveTimeoutRef.current) clearTimeout(throttledSaveTimeoutRef.current)
    saveTimeoutRef.current = null
    throttledSaveTimeoutRef.current = null
    pendingContentRef.current = null
    restoredDraftAutosaveRef.current = null
    const serverContent = resolveEntryContent(conflictEntry)
    setContent(serverContent)
    currentContentRef.current = serverContent
    lastSavedContentRef.current = JSON.stringify(serverContent)
    if (todayRef.current) {
      safeSessionRemove(getDailyLogDraftKey(classroom.id, todayRef.current))
      removeDailyLogDraft(studentId, classroom.id, todayRef.current)
    }
    hasLocalEditSinceLoadRef.current = false
    entryIdRef.current = conflictEntry.id
    entryVersionRef.current = conflictEntry.version ?? entryVersionRef.current
    setSaveStatus('saved')
    setSaveError('')
    setConflictEntry(null)
  }, [classroom.id, conflictEntry, studentId])

  const retryAfterConflict = useCallback(() => {
    if (!conflictEntry) return
    entryIdRef.current = conflictEntry.id
    entryVersionRef.current = conflictEntry.version ?? entryVersionRef.current
    const draft = readDailyLogDraft(studentId, classroom.id, todayRef.current)
    if (draft) writeDailyLogDraft({ ...draft, entryId: conflictEntry.id, version: conflictEntry.version ?? draft.version })
    setConflictEntry(null)
    const latest = pendingContentRef.current ?? content
    const date = todayRef.current
    const saveKey = `${studentId}:${classroom.id}:${date}`
    const previousSave = saveQueuesByDateRef.current.get(saveKey) ?? Promise.resolve()
    const retry = previousSave.catch(() => undefined).then(() => saveContent(latest, date, { forceFull: true }))
    saveQueuesByDateRef.current.set(saveKey, retry.catch(() => undefined))
  }, [conflictEntry, content, saveContent, studentId, classroom.id])

  function acceptSavedOlderLog(date: string) {
    removeDailyLogDraft(studentId, classroom.id, date)
    safeSessionRemove(getDailyLogDraftKey(classroom.id, date))
    setOlderDrafts(listDailyLogDrafts(studentId, classroom.id, getTodayInToronto()))
    setOlderConflicts(prev => {
      const next = { ...prev }
      delete next[date]
      return next
    })
  }

  function replaceSavedOlderLog(date: string) {
    const draft = readDailyLogDraft(studentId, classroom.id, date)
    const serverEntry = olderConflicts[date]
    if (!draft || !serverEntry) return
    writeDailyLogDraft({ ...draft, entryId: serverEntry.id, version: serverEntry.version ?? draft.version })
    setOlderConflicts(prev => {
      const next = { ...prev }
      delete next[date]
      return next
    })
    enqueueSave(date)
  }

  const isClassDay = today ? isClassDayOnDate(classDays, today) : true
  const hasCurrentEntriesSnapshot = entriesSnapshotClassroomId === classroom.id

  const blockingState = classDaysError && !hasClassDaysSnapshot ? (
    <PageState
      kind="error"
      title="Class schedule unavailable"
      description={classDaysError}
      compact
      action={(
        <Button type="button" onClick={() => void refreshClassDays()}>
          Try again
        </Button>
      )}
    />
  ) : entriesError && !hasCurrentEntriesSnapshot ? (
    <PageState
      kind="error"
      title="Daily log unavailable"
      description={entriesError}
      compact
      action={(
        <Button type="button" onClick={retryEntries}>
          Try again
        </Button>
      )}
    />
  ) : loading || classDaysLoading || !hasCurrentEntriesSnapshot ? (
    <div className="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  ) : null

  const mobilePlanContent = mobilePlan ? (
    <div className="min-h-0 w-full overflow-hidden rounded-lg border border-border bg-surface lg:hidden">
      {mobilePlan}
    </div>
  ) : null

  if (blockingState) {
    if (layout === 'pane') {
      return (
        <div className="h-full min-h-0 overflow-y-auto">
          <PageStack>
            {blockingState}
            {mobilePlanContent}
          </PageStack>
        </div>
      )
    }
    return (
      <PageLayout>
        <PageContent>
          <PageStack>
            {blockingState}
            {mobilePlanContent}
          </PageStack>
        </PageContent>
      </PageLayout>
    )
  }

  const pastHistoryEntries = classDays
    .filter(day => day.is_class_day && day.date < today)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, pastHistoryLimit)
    .map(day => ({
      date: day.date,
      entry: historyEntries.find(entry => entry.date === day.date) ?? null,
    }))

  const todayContent = (
    <PageStack>
      {classDaysError && hasClassDaysSnapshot && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-4 py-3">
          <p className="text-sm text-danger">The latest class schedule could not be loaded.</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refreshClassDays()}>
            Try again
          </Button>
        </div>
      )}
      {entriesError && hasCurrentEntriesSnapshot && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-4 py-3">
          <p className="text-sm text-danger">The latest daily log could not be loaded.</p>
          <Button type="button" size="sm" variant="secondary" onClick={retryEntries}>
            Try again
          </Button>
        </div>
      )}
      {olderDrafts.map(draft => (
        <div key={draft.date} role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning bg-warning-bg px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text-default">
              Unsent Daily Log from {format(parseISO(draft.date), 'EEE MMM d')}
            </p>
            <p className="text-sm text-text-muted">
              {olderDraftError[draft.date] || (olderDraftSavingDate === draft.date
                ? 'Saving it under its original date…'
                : 'It is saved on this device and will be sent under its original date.')}
            </p>
            {olderConflicts[draft.date] && (
              <div className="mt-2 space-y-1 text-sm text-text-default">
                <p><span className="font-medium">Device draft:</span> {extractPlainText(draft.content)}</p>
                <p><span className="font-medium">Saved log:</span> {olderConflicts[draft.date].text || '(empty)'}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {olderConflicts[draft.date] ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => acceptSavedOlderLog(draft.date)}>
                  Use saved log
                </Button>
                <Button type="button" size="sm" onClick={() => replaceSavedOlderLog(draft.date)}>
                  Replace saved log
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={olderDraftSavingDate === draft.date} onClick={() => enqueueSave(draft.date)}>
                {olderDraftSavingDate === draft.date ? 'Saving…' : 'Retry save'}
              </Button>
            )}
          </div>
        </div>
      ))}
      <div className="bg-surface rounded-lg border border-border p-6">
        {!isClassDay ? (
          <div className="bg-page border border-border rounded-lg p-4 text-center">
            <p className="text-text-muted">No class today</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between mb-2">
              <h2 id="student-daily-log-heading" className="text-sm font-medium text-text-default">
                {DAILY_LOG_TITLE}
              </h2>
              <SaveStatus status={saveStatus} className="text-sm" />
            </div>
            <RichTextEditor
              content={content}
              onChange={handleContentChange}
              onBlur={flushAutosave}
              placeholder="What is your plan today?"
              aria-labelledby="student-daily-log-heading"
              editable={true}
              toolbarPreset="brief"
              className="[&_.tiptap.ProseMirror]:!min-h-[100px] [&_.tiptap.ProseMirror]:!p-0 lg:[&_.tiptap.ProseMirror]:!min-h-[200px]"
            />

            {saveError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-danger">{saveError}</p>
                {conflictEntry && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={resolveConflict}>
                      Reload latest
                    </Button>
                    <Button type="button" size="sm" onClick={retryAfterConflict}>
                      Retry save
                    </Button>
                  </div>
                )}
                {!conflictEntry && saveStatus === 'unsaved' && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => scheduleSave(currentContentRef.current, { force: true })}>
                    Retry save
                  </Button>
                )}
              </div>
            )}
            {draftStorageUnavailable && saveStatus !== 'saved' && (
              <p role="alert" className="text-sm text-danger">
                This draft could not be kept on this device. Keep this page open until it says Saved.
              </p>
            )}
          </div>
        )}
      </div>

      <StudentPastLogs key={classroom.id} logs={pastHistoryEntries} />

      {mobilePlanContent}
    </PageStack>
  )

  if (layout === 'pane') {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        {todayContent}
      </div>
    )
  }

  return (
    <PageLayout>
      <PageContent>
        {todayContent}
      </PageContent>
    </PageLayout>
  )
}
