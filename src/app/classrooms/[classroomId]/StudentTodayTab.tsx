'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Button, PageState } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import { PageContent, PageLayout, PageStack } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { isClassDayOnDate } from '@/lib/class-days'
import { useClassDaysContext } from '@/hooks/useClassDays'
import { format, parseISO } from 'date-fns'
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
  isAuthFailureStatus,
  redirectToLoginForReauth,
  SESSION_EXPIRED_MESSAGE,
} from '@/lib/client-auth'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { countCharacters, isEmpty, plainTextToTiptapContent } from '@/lib/tiptap-content'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
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

// Daily reflection openers, rotated by calendar date so the whole class sees the
// same prompt on a given day. 20 prompts at ~5 school days a week means a given
// prompt comes back around every few weeks.
const DAILY_REFLECTION_PROMPTS = [
  "What's one thing you're proud of from last time?",
  "What's something you figured out recently?",
  'What went well, and what felt tricky?',
  'How did your last plan turn out?',
  "What's a small win from your last session?",
  'Where did you get stuck last time — and what did you try?',
  "What's one thing you want to keep doing?",
  'What would you do differently from last time?',
  'What surprised you in your recent work?',
  'What are you curious to dig into more?',
  "What's starting to click for you lately?",
  "What's a question you're still sitting with?",
  'Who or what helped you recently?',
  'What felt like hard work worth doing?',
  "What's something you almost gave up on but didn't?",
  'How are you feeling about your progress so far?',
  "What's one habit you want to build this week?",
  'What did a recent mistake teach you?',
  'What do you want to get better at?',
  'What are you looking forward to?',
] as const

// Shown when there's no prior post to reflect on yet.
const NO_LAST_LOG_PROMPT = 'Fresh start — how are you feeling about today?'
const DAILY_PLAN_PROMPT = "What's your plan for today?"

// Deterministic day index from a 'YYYY-MM-DD' string (timezone-independent), so
// every student in the class lands on the same prompt for a given date.
function getDailyReflectionPrompt(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return DAILY_REFLECTION_PROMPTS[0]
  const dayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
  const count = DAILY_REFLECTION_PROMPTS.length
  return DAILY_REFLECTION_PROMPTS[((dayIndex % count) + count) % count]
}


interface StudentTodayTabProps {
  classroom: Classroom
  layout?: 'page' | 'pane'
  onLessonPlanLoad?: (plan: LessonPlan | null, classroomId: string) => void
}

export function StudentTodayTab({ classroom, layout = 'page', onLessonPlanLoad }: StudentTodayTabProps) {
  const notifications = useStudentNotifications()
  const {
    classDays,
    error: classDaysError,
    hasLoadedSnapshot: hasClassDaysSnapshot,
    isLoading: classDaysLoading,
    refresh: refreshClassDays,
  } = useClassDaysContext()

  // Constants
  const historyLimit = 12
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
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(() => new Set())
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [saveError, setSaveError] = useState('')
  const [conflictEntry, setConflictEntry] = useState<Entry | null>(null)

  // Refs for autosave
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
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
  currentClassroomIdRef.current = classroom.id

  useEffect(() => {
    async function load() {
      const requestId = loadRequestIdRef.current + 1
      loadRequestIdRef.current = requestId
      const requestedClassroomId = classroom.id
      const hasCurrentSnapshot = entriesSnapshotClassroomIdRef.current === requestedClassroomId
      const isCurrentLoad = () => (
        loadRequestIdRef.current === requestId &&
        currentClassroomIdRef.current === requestedClassroomId
      )

      setEntriesError(null)
      if (!hasCurrentSnapshot) {
        setLoading(true)
        setHistoryEntries([])
        setEntriesSnapshotClassroomId(null)
      }
      try {
        const todayDate = getTodayInToronto()
        todayRef.current = todayDate
        setToday(todayDate)

        const historyCacheKey = getStudentEntryHistoryCacheKey({
          classroomId: classroom.id,
          limit: historyLimit,
        })
        const cached = safeSessionGetJson<Entry[]>(historyCacheKey)

        // Fetch today's lesson plan (class days come from context)
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
            onLessonPlanLoad?.(null, requestedClassroomId)
          })

        const applyEntryState = (todayEntry: Entry | null) => {
          if (!isCurrentLoad()) return

          const loadedContent = resolveEntryContent(todayEntry)
          const draftContent = safeSessionGetJson<TiptapContent>(
            getDailyLogDraftKey(requestedClassroomId, todayDate)
          )
          if (
            draftContent &&
            !isEmpty(draftContent) &&
            JSON.stringify(draftContent) !== JSON.stringify(loadedContent)
          ) {
            setContent(draftContent)
            currentContentRef.current = draftContent
            pendingContentRef.current = draftContent
            restoredDraftAutosaveRef.current = draftContent
            hasLocalEditSinceLoadRef.current = true
            setSaveStatus('unsaved')
          }

          if (!draftContent || isEmpty(draftContent) || JSON.stringify(draftContent) === JSON.stringify(loadedContent)) {
            setContent(loadedContent)
            currentContentRef.current = loadedContent
            pendingContentRef.current = null
            hasLocalEditSinceLoadRef.current = false
            setSaveStatus('saved')
          }

          lastSavedContentRef.current = JSON.stringify(loadedContent)
          setSaveError('')
          setConflictEntry(null)
          entryIdRef.current = todayEntry?.id ?? null
          entryVersionRef.current = todayEntry?.version ?? 1
        }

        if (Array.isArray(cached)) {
          if (!isCurrentLoad()) return
          setHistoryEntries(cached)
          const todayEntry = cached.find((e: Entry) => e.date === todayDate) || null
          applyEntryState(todayEntry)
          entriesSnapshotClassroomIdRef.current = requestedClassroomId
          setEntriesSnapshotClassroomId(requestedClassroomId)
          setLoading(false)
        }

        const entriesPromise = fetchStudentEntriesForClassroom(requestedClassroomId, { limit: historyLimit })
          .then(entries => {
            if (!isCurrentLoad()) return
            entriesSnapshotClassroomIdRef.current = requestedClassroomId
            setEntriesSnapshotClassroomId(requestedClassroomId)
            if (hasLocalEditSinceLoadRef.current) {
              setHistoryEntries(prev => {
                if (!isCurrentLoad()) return prev
                const currentTodayEntry = prev.find((e: Entry) => e.date === todayDate) || null
                const next = currentTodayEntry
                  ? upsertEntryIntoHistory(entries, currentTodayEntry, historyLimit)
                  : entries
                safeSessionSetJson(historyCacheKey, next)
                return next
              })
              return
            }
            setHistoryEntries(entries)
            safeSessionSetJson(historyCacheKey, entries)
            const todayEntry = entries.find((e: Entry) => e.date === todayDate) || null
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
  }, [classroom.id, entriesRequestVersion, historyLimit, onLessonPlanLoad])

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
    options?: { forceFull?: boolean }
  ) => {
    const currentToday = getTodayInToronto()
    const entryDate = currentToday || todayRef.current
    if (!entryDate) return

    if (todayRef.current !== entryDate) {
      todayRef.current = entryDate
      setToday(entryDate)
      entryIdRef.current = null
      entryVersionRef.current = 1
      lastSavedContentRef.current = JSON.stringify(EMPTY_DOC)
      setConflictEntry(null)
    }

    // Don't create a new DB record for empty content (e.g. TipTap mount normalization)
    const newContentStr = JSON.stringify(newContent)
    const draftKey = getDailyLogDraftKey(classroom.id, entryDate)

    if (!entryIdRef.current && isEmpty(newContent)) {
      lastSavedContentRef.current = newContentStr
      safeSessionRemove(draftKey)
      setSaveStatus('saved')
      return
    }

    if (!options?.forceFull && newContentStr === lastSavedContentRef.current) {
      safeSessionRemove(draftKey)
      setSaveStatus('saved')
      return
    }

    if (countCharacters(newContent) > MAX_CHARS) {
      setSaveError(`Entry exceeds ${MAX_CHARS} character limit`)
      setSaveStatus('unsaved')
      return
    }

    setSaveStatus('saving')
    setSaveError('')
    safeSessionSetJson(draftKey, newContent)
    lastSaveAttemptAtRef.current = Date.now()

    const baseContent = parseSavedContent(lastSavedContentRef.current)
    const patch = createJsonPatch(baseContent, newContent)
    const shouldSendPatch =
      !options?.forceFull &&
      entryIdRef.current &&
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
      entry_id: entryIdRef.current ?? undefined,
      version: entryVersionRef.current,
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

      if (isAuthFailureStatus(response.status)) {
        setSaveStatus('unsaved')
        setSaveError(SESSION_EXPIRED_MESSAGE)
        redirectToLoginForReauth()
        return
      }

      if (response.status === 409) {
        const serverEntry = data.entry as Entry | undefined
        if (serverEntry) {
          setConflictEntry(serverEntry)
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
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        if (throttledSaveTimeoutRef.current) {
          clearTimeout(throttledSaveTimeoutRef.current)
          throttledSaveTimeoutRef.current = null
        }
        setSaveStatus('unsaved')
        setSaveError(data.error || 'Entry updated elsewhere')
        return
      }

      if (response.status === 404 && shouldSendPatch) {
        await saveContent(newContent, { forceFull: true })
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      const savedEntry = data.entry as Entry
      const savedContentStillCurrent = JSON.stringify(currentContentRef.current) === newContentStr
      const savedEntryContent = resolveEntryContent(savedEntry)

      entryIdRef.current = savedEntry.id
      entryVersionRef.current = savedEntry.version ?? entryVersionRef.current

      invalidateStudentEntriesForClassroom(classroom.id)
      updateHistoryEntries(savedEntry)
      lastSavedContentRef.current = JSON.stringify(savedEntryContent)
      if (savedContentStillCurrent) {
        safeSessionRemove(draftKey)
        pendingContentRef.current = null
        restoredDraftAutosaveRef.current = null
        hasLocalEditSinceLoadRef.current = false
        setSaveStatus('saved')
        setSaveError('')
        setConflictEntry(null)
        notifications?.markTodayComplete()
      } else {
        setSaveStatus('unsaved')
      }
    } catch (err: any) {
      console.error('Error saving:', err)
      setSaveStatus('unsaved')
      setSaveError(err.message || 'Failed to save')
    }
  }, [MAX_CHARS, classroom.id, historyLimit, updateHistoryEntries, notifications])

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
      void saveContent(newContent)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingContentRef.current
      if (latest) {
        void saveContent(latest)
      }
    }, waitMs)
  }, [AUTOSAVE_MIN_INTERVAL_MS, conflictEntry, saveContent])

  useEffect(() => {
    if (loading || conflictEntry) return

    const restoredDraft = restoredDraftAutosaveRef.current
    if (!restoredDraft) return

    restoredDraftAutosaveRef.current = null
    scheduleSave(restoredDraft, { force: true })
  }, [conflictEntry, loading, scheduleSave])

  function handleContentChange(newContent: TiptapContent) {
    setContent(newContent)
    currentContentRef.current = newContent

    const newContentStr = JSON.stringify(newContent)
    const draftKey = todayRef.current
      ? getDailyLogDraftKey(classroom.id, todayRef.current)
      : null

    if (newContentStr === lastSavedContentRef.current || (!entryIdRef.current && isEmpty(newContent))) {
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
      safeSessionSetJson(draftKey, newContent)
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

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function flushAutosave() {
    if (conflictEntry) return
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      scheduleSave(pendingContentRef.current, { force: true })
    }
  }

  const resolveConflict = useCallback(() => {
    if (!conflictEntry) return
    const serverContent = resolveEntryContent(conflictEntry)
    setContent(serverContent)
    currentContentRef.current = serverContent
    lastSavedContentRef.current = JSON.stringify(serverContent)
    if (todayRef.current) {
      safeSessionRemove(getDailyLogDraftKey(classroom.id, todayRef.current))
    }
    hasLocalEditSinceLoadRef.current = false
    entryIdRef.current = conflictEntry.id
    entryVersionRef.current = conflictEntry.version ?? entryVersionRef.current
    setSaveStatus('saved')
    setSaveError('')
    setConflictEntry(null)
  }, [classroom.id, conflictEntry])

  const retryAfterConflict = useCallback(() => {
    if (!conflictEntry) return
    entryIdRef.current = conflictEntry.id
    entryVersionRef.current = conflictEntry.version ?? entryVersionRef.current
    setConflictEntry(null)
    const latest = pendingContentRef.current ?? content
    void saveContent(latest, { forceFull: true })
  }, [conflictEntry, content, saveContent])

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

  if (blockingState) {
    if (layout === 'pane') {
      return <div className="h-full min-h-0 overflow-y-auto">{blockingState}</div>
    }
    return (
      <PageLayout>
        <PageContent>{blockingState}</PageContent>
      </PageLayout>
    )
  }

  const pastHistoryEntries = historyEntries.filter(entry => entry.date !== today)
  const lastLog = pastHistoryEntries[0] ?? null
  const hasLastLog =
    !!lastLog && (!!lastLog.text?.trim() || !isEmpty(resolveEntryContent(lastLog)))
  const reflectionPrompt = hasLastLog
    ? getDailyReflectionPrompt(today)
    : NO_LAST_LOG_PROMPT

  function toggleHistoryEntry(entryId: string) {
    setExpandedHistoryIds(prev => {
      const next = new Set(prev)
      if (next.has(entryId)) {
        next.delete(entryId)
      } else {
        next.add(entryId)
      }
      return next
    })
  }

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
      <div className="bg-surface rounded-lg border border-border p-6">
        {!isClassDay ? (
          <div className="bg-page border border-border rounded-lg p-4 text-center">
            <p className="text-text-muted">No class today</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between mb-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-text-default">
                  {reflectionPrompt}
                </span>
                <span className="text-sm text-text-muted">
                  {DAILY_PLAN_PROMPT}
                </span>
              </label>
              <span
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={
                  'text-sm ' +
                  (saveStatus === 'saved'
                    ? 'text-success'
                    : saveStatus === 'saving'
                      ? 'text-text-muted'
                      : 'text-warning')
                }
              >
                {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
              </span>
            </div>
            <RichTextEditor
              content={content}
              onChange={handleContentChange}
              onBlur={flushAutosave}
              placeholder="Write something..."
              editable={true}
              showToolbar={false}
              className="min-h-[200px] [&_.tiptap.ProseMirror]:!p-0"
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
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-default">Past logs</h2>
        </div>
        <div className="divide-y divide-border">
          {pastHistoryEntries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-text-muted">
              No past logs yet
            </div>
          ) : (
            pastHistoryEntries.map(entry => {
              const isExpanded = expandedHistoryIds.has(entry.id)
              const entryDateLabel = format(parseISO(entry.date), 'EEE MMM d')

              return (
                <button
                  key={entry.id}
                  type="button"
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} log from ${entryDateLabel}`}
                  onClick={() => toggleHistoryEntry(entry.id)}
                >
                  <p className="text-sm font-medium text-text-default">
                    {entryDateLabel}
                  </p>
                  <p
                    className={[
                      'mt-1 text-sm text-text-muted whitespace-pre-wrap',
                      isExpanded ? '' : 'line-clamp-2',
                    ].join(' ')}
                  >
                    {entry.text || ''}
                  </p>
                </button>
              )
            })
          )}
        </div>
      </div>
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
