'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Button } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/editor'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { isClassDayOnDate } from '@/lib/class-days'
import { format, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import {
  readBooleanCookie,
  safeSessionGetJson,
  safeSessionSetJson,
  writeCookie,
} from '@/lib/client-storage'
import {
  getEntryPreview,
  getStudentEntryHistoryCacheKey,
  upsertEntryIntoHistory,
} from '@/lib/student-entry-history'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { countCharacters, plainTextToTiptapContent } from '@/lib/tiptap-content'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import type { Classroom, ClassDay, Entry, JsonPatchOperation, LessonPlan, TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }

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


interface StudentTodayTabProps {
  classroom: Classroom
  onLessonPlanLoad?: (plan: LessonPlan | null) => void
}

export function StudentTodayTab({ classroom, onLessonPlanLoad }: StudentTodayTabProps) {
  const notifications = useStudentNotifications()

  // Constants
  const historyLimit = 5
  const historyCookieName = 'pika_student_today_history'
  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000
  const MAX_CHARS = 2000

  // State
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState('')
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [historyEntries, setHistoryEntries] = useState<Entry[]>([])
  const [historyVisible, setHistoryVisible] = useState<boolean>(() =>
    readBooleanCookie(historyCookieName, true)
  )
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [saveError, setSaveError] = useState('')
  const [conflictEntry, setConflictEntry] = useState<Entry | null>(null)

  // Refs for autosave
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const pendingContentRef = useRef<TiptapContent | null>(null)
  const entryIdRef = useRef<string | null>(null)
  const entryVersionRef = useRef(1)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const todayDate = getTodayInToronto()
        setToday(todayDate)

        const historyCacheKey = getStudentEntryHistoryCacheKey({
          classroomId: classroom.id,
          limit: historyLimit,
        })
        const cached = safeSessionGetJson<Entry[]>(historyCacheKey)

        const classDayPromise = fetch(`/api/classrooms/${classroom.id}/class-days`)
          .then(r => r.json())
          .then(data => setClassDays(data.class_days || []))

        // Fetch today's lesson plan
        const lessonPlanPromise = fetch(
          `/api/student/classrooms/${classroom.id}/lesson-plans?start=${todayDate}&end=${todayDate}`
        )
          .then(r => r.json())
          .then(data => {
            const plans = data.lesson_plans || []
            const todayPlan = plans.find((p: LessonPlan) => p.date === todayDate) || null
            onLessonPlanLoad?.(todayPlan)
          })
          .catch(err => {
            console.error('Error loading lesson plan:', err)
            onLessonPlanLoad?.(null)
          })

        const applyEntryState = (todayEntry: Entry | null) => {
          const loadedContent = resolveEntryContent(todayEntry)
          setContent(loadedContent)
          lastSavedContentRef.current = JSON.stringify(loadedContent)
          setSaveStatus('saved')
          setSaveError('')
          setConflictEntry(null)
          entryIdRef.current = todayEntry?.id ?? null
          entryVersionRef.current = todayEntry?.version ?? 1
        }

        if (Array.isArray(cached)) {
          setHistoryEntries(cached)
          const todayEntry = cached.find((e: Entry) => e.date === todayDate) || null
          applyEntryState(todayEntry)
          await Promise.all([classDayPromise, lessonPlanPromise])
          return
        }

        const entriesPromise = fetch(
          `/api/student/entries?classroom_id=${classroom.id}&limit=${historyLimit}`
        )
          .then(r => r.json())
          .then(data => {
            const entries: Entry[] = data.entries || []
            setHistoryEntries(entries)
            safeSessionSetJson(historyCacheKey, entries)
            const todayEntry = entries.find((e: Entry) => e.date === todayDate) || null
            applyEntryState(todayEntry)
          })

        await Promise.all([classDayPromise, entriesPromise, lessonPlanPromise])
      } catch (err) {
        console.error('Error loading today tab:', err)
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
      }
    }
  }, [classroom.id, historyLimit, onLessonPlanLoad])

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
    if (!today) return

    const newContentStr = JSON.stringify(newContent)
    if (!options?.forceFull && newContentStr === lastSavedContentRef.current) {
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
      date: today,
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

      if (response.status === 409) {
        const serverEntry = data.entry as Entry | undefined
        if (serverEntry) {
          setConflictEntry(serverEntry)
        }
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
      entryIdRef.current = savedEntry.id
      entryVersionRef.current = savedEntry.version ?? entryVersionRef.current
      updateHistoryEntries(savedEntry)
      lastSavedContentRef.current = newContentStr
      setSaveStatus('saved')
      setSaveError('')
      setConflictEntry(null)
      notifications?.markTodayComplete()
    } catch (err: any) {
      console.error('Error saving:', err)
      setSaveStatus('unsaved')
      setSaveError(err.message || 'Failed to save')
    }
  }, [MAX_CHARS, classroom.id, today, updateHistoryEntries, notifications])

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

  function handleContentChange(newContent: TiptapContent) {
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent

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
    lastSavedContentRef.current = JSON.stringify(serverContent)
    entryIdRef.current = conflictEntry.id
    entryVersionRef.current = conflictEntry.version ?? entryVersionRef.current
    setSaveStatus('saved')
    setSaveError('')
    setConflictEntry(null)
  }, [conflictEntry])

  const retryAfterConflict = useCallback(() => {
    if (!conflictEntry) return
    entryIdRef.current = conflictEntry.id
    entryVersionRef.current = conflictEntry.version ?? entryVersionRef.current
    setConflictEntry(null)
    const latest = pendingContentRef.current ?? content
    void saveContent(latest, { forceFull: true })
  }, [conflictEntry, content, saveContent])

  const isClassDay = today ? isClassDayOnDate(classDays, today) : true

  function setHistoryVisibility(next: boolean) {
    setHistoryVisible(next)
    writeCookie(historyCookieName, next ? '1' : '0')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const historyListId = `student-today-history-${classroom.id}`

  return (
    <PageLayout>
      <PageContent>
        <div className="space-y-6">
          <div className="bg-surface rounded-lg shadow-sm p-6">
            {!isClassDay ? (
              <div className="bg-page border border-border rounded-lg p-4 text-center">
                <p className="text-text-muted">No class today</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-muted">
                    What did you do today?
                  </label>
                  <span
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
                  placeholder="Write a short update..."
                  editable={true}
                  showToolbar={false}
                  className="min-h-[200px] [&_.tiptap.ProseMirror]:!p-0"
                />

                {saveError && (
                  <div className="space-y-2">
                    <p className="text-sm text-danger">{saveError}</p>
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

          <div className="bg-surface border border-border rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-border flex items-center justify-end">
              <button
                type="button"
                className="inline-flex items-center p-1 text-info hover:bg-surface-hover rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                aria-expanded={historyVisible}
                aria-controls={historyListId}
                aria-label={historyVisible ? 'Hide history' : 'Show history'}
                onClick={() => setHistoryVisibility(!historyVisible)}
              >
                <ChevronDown
                  className={[
                    'h-5 w-5 transition-transform',
                    historyVisible ? 'rotate-180' : 'rotate-0',
                  ].join(' ')}
                />
              </button>
            </div>
            {historyVisible && (
              <div id={historyListId} className="divide-y divide-border">
                {historyEntries.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-text-muted">
                    No logs yet
                  </div>
                ) : (
                  historyEntries.map(entry => (
                    <div key={entry.id} className="px-4 py-2">
                      <p className="text-sm font-medium text-text-default">
                        {format(parseISO(entry.date), 'EEE MMM d')}
                      </p>
                      <p className="text-sm text-text-muted">
                        {getEntryPreview(entry.text, 150)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
