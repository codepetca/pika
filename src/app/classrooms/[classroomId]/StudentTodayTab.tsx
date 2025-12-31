'use client'

import { useEffect, useState, FormEvent, useRef, useCallback } from 'react'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
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
import type { Classroom, ClassDay, Entry } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentTodayTab({ classroom }: Props) {
  const historyLimit = 5
  const historyCookieName = 'pika_student_today_history'
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState('')
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [existingEntry, setExistingEntry] = useState<Entry | null>(null)
  const [text, setText] = useState('')
  const [historyEntries, setHistoryEntries] = useState<Entry[]>([])
  const [historyVisible, setHistoryVisible] = useState<boolean>(() =>
    readBooleanCookie(historyCookieName, true)
  )
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null)

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

          // Check for draft
          const draft = loadDraft(classroom.id, todayDate, todayEntry?.updated_at)
          if (draft && draft.isDraftNewer) {
            setText(draft.text)
            setDraftRestored(true)
            setTimeout(() => setDraftRestored(false), 3000)
          } else {
            setText(todayEntry?.text || '')
          }

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

            // Check for draft
            const draft = loadDraft(classroom.id, todayDate, todayEntry?.updated_at)
            if (draft && draft.isDraftNewer) {
              setText(draft.text)
              setDraftRestored(true)
              setTimeout(() => setDraftRestored(false), 3000)
            } else {
              setText(todayEntry?.text || '')
            }
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

  // Debounced autosave to localStorage
  useEffect(() => {
    if (!today || !text) return

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }

    // Set new timer (500ms debounce)
    autosaveTimerRef.current = setTimeout(() => {
      saveDraft({
        classroomId: classroom.id,
        date: today,
        text,
      })
    }, 500)

    // Cleanup on unmount
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [classroom.id, today, text])

  const isClassDay = today ? isClassDayOnDate(classDays, today) : true

  function setHistoryVisibility(next: boolean) {
    setHistoryVisible(next)
    writeCookie(historyCookieName, next ? '1' : '0')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const response = await fetch('/api/student/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          date: today,
          text,
          mood: null,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save entry')
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

      // Clear draft on successful save
      clearDraft(classroom.id, today)

      setSuccess('Entry saved!')
      setTimeout(() => setSuccess(''), 2000)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setSubmitting(false)
    }
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
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    What did you do today?
                  </label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Write a short update..."
                    required
                    disabled={submitting}
                  />
                </div>

                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                {success && (
                  <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
                )}
                {draftRestored && (
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    Draft restored from auto-save
                  </p>
                )}

                <Button type="submit" disabled={submitting || !text}>
                  {submitting ? 'Saving...' : existingEntry ? 'Update' : 'Save'}
                </Button>
              </form>
            )}
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">History</h3>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-300 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                aria-expanded={historyVisible}
                aria-controls={historyListId}
                onClick={() => setHistoryVisibility(!historyVisible)}
              >
                {historyVisible ? 'Hide history' : 'Show history'}
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
