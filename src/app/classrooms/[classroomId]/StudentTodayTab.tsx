'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/RichTextEditor'
import { PageContent, PageLayout } from '@/components/PageLayout'
import { getTodayInToronto } from '@/lib/timezone'
import { isClassDayOnDate } from '@/lib/class-days'
import { format, parseISO } from 'date-fns'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
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
import { saveDraft, loadDraft, clearDraft } from '@/lib/draft-storage'
import { countCharacters, isEmpty, extractPlainText, plainTextToTiptapContent } from '@/lib/tiptap-content'
import type { Classroom, ClassDay, Entry, TiptapContent } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentTodayTab({ classroom }: Props) {
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
  const [existingEntry, setExistingEntry] = useState<Entry | null>(null)
  const [content, setContent] = useState<TiptapContent>({ type: 'doc', content: [] })
  const [historyEntries, setHistoryEntries] = useState<Entry[]>([])
  const [historyVisible, setHistoryVisible] = useState<boolean>(() =>
    readBooleanCookie(historyCookieName, true)
  )
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')

  // Refs for autosave
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const pendingContentRef = useRef<TiptapContent | null>(null)

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

        if (Array.isArray(cached)) {
          setHistoryEntries(cached)
          const todayEntry = cached.find((e: Entry) => e.date === todayDate) || null
          setExistingEntry(todayEntry)

          // Load content: prefer rich_content, fall back to converted text
          let loadedContent: TiptapContent
          if (todayEntry?.rich_content) {
            loadedContent = todayEntry.rich_content
          } else if (todayEntry?.text) {
            loadedContent = plainTextToTiptapContent(todayEntry.text)
          } else {
            loadedContent = { type: 'doc', content: [] }
          }

          setContent(loadedContent)
          lastSavedContentRef.current = JSON.stringify(loadedContent)
          setSaveStatus('saved')

          await classDayPromise
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
            setExistingEntry(todayEntry)

            // Load content: prefer rich_content, fall back to converted text
            let loadedContent: TiptapContent
            if (todayEntry?.rich_content) {
              loadedContent = todayEntry.rich_content
            } else if (todayEntry?.text) {
              loadedContent = plainTextToTiptapContent(todayEntry.text)
            } else {
              loadedContent = { type: 'doc', content: [] }
            }

            setContent(loadedContent)
            lastSavedContentRef.current = JSON.stringify(loadedContent)
            setSaveStatus('saved')
          })

        await Promise.all([classDayPromise, entriesPromise])
      } catch (err) {
        console.error('Error loading today tab:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  // Server autosave logic
  const saveContent = useCallback(async (newContent: TiptapContent) => {
    const newContentStr = JSON.stringify(newContent)
    if (newContentStr === lastSavedContentRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')
    lastSaveAttemptAtRef.current = Date.now()

    try {
      const response = await fetch('/api/student/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          date: today,
          rich_content: newContent,
          mood: null,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      setExistingEntry(data.entry)
      setHistoryEntries(prev => {
        const next = upsertEntryIntoHistory(prev, data.entry, historyLimit)
        safeSessionSetJson(
          getStudentEntryHistoryCacheKey({
            classroomId: classroom.id,
            limit: historyLimit,
          }),
          next
        )
        return next
      })

      lastSavedContentRef.current = newContentStr
      setSaveStatus('saved')
      clearDraft(classroom.id, today)
    } catch (err: any) {
      console.error('Error saving:', err)
      setSaveStatus('unsaved')
    }
  }, [classroom.id, today, historyLimit])

  const scheduleSave = useCallback((newContent: TiptapContent, options?: { force?: boolean }) => {
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
  }, [AUTOSAVE_MIN_INTERVAL_MS, saveContent])

  function handleContentChange(newContent: TiptapContent) {
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function flushAutosave() {
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      scheduleSave(pendingContentRef.current, { force: true })
    }
  }

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
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
            {!isClassDay ? (
              <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center">
                <p className="text-gray-600 dark:text-gray-400">No class today</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    What did you do today?
                  </label>
                  <RichTextEditor
                    content={content}
                    onChange={handleContentChange}
                    onBlur={flushAutosave}
                    placeholder="Write a short update..."
                    disabled={submitting}
                    editable={true}
                    className="min-h-[200px]"
                  />
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className={countCharacters(content) > MAX_CHARS ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}>
                      {countCharacters(content)} / {MAX_CHARS} characters
                    </span>
                    <span className={
                      saveStatus === 'saved'
                        ? 'text-green-600 dark:text-green-400'
                        : saveStatus === 'saving'
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-orange-600 dark:text-orange-400'
                    }>
                      {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved changes'}
                    </span>
                  </div>
                </div>

                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                {success && (
                  <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Past Logs</h3>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-300 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                aria-expanded={historyVisible}
                aria-controls={historyListId}
                onClick={() => setHistoryVisibility(!historyVisible)}
              >
                {historyVisible ? 'Hide' : 'Show'}
                <ChevronDownIcon
                  className={[
                    'h-4 w-4 transition-transform',
                    historyVisible ? '-rotate-180' : 'rotate-0',
                  ].join(' ')}
                  aria-hidden="true"
                />
              </button>
            </div>

            {historyVisible && (
              <div id={historyListId} className="divide-y divide-gray-200 dark:divide-gray-700">
                {historyEntries.slice(0, historyLimit).map(entry => (
                  <div key={entry.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0">
                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200">
                          <span>{format(parseISO(entry.date), 'EEE MMM d')}</span>
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug break-words">
                          {getEntryPreview(entry.text, 150)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {historyEntries.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    No past entries yet
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
