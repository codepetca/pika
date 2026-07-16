'use client'

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Tooltip } from '@/ui'
import { ConfirmDialog } from '@/ui/Dialog'
import { Card } from '@/ui/Card'
import { EmptyState } from '@/ui/EmptyState'
import { History } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor, RichTextViewer } from '@/components/editor'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatAssignmentTiming,
  formatDueDate,
  calculateAssignmentStatus,
  canUnsubmitAssignmentDoc,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
  hasAssignmentSubmissionContent,
} from '@/lib/assignments'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { isValidTiptapContent } from '@/lib/tiptap-content'
import { fetchJSONWithCache } from '@/lib/request-cache'
import {
  safeLocalGetJson,
  safeLocalRemove,
  safeLocalSetJson,
  safeSessionGetJson,
  safeSessionRemove,
  safeSessionSetJson,
} from '@/lib/client-storage'
import { formatInTimeZone } from 'date-fns-tz'
import { HistoryList } from '@/components/HistoryList'
import { useStudentNotifications } from '@/components/StudentNotificationsProvider'
import { StudentAssignmentSubmissionChecklist } from '@/components/StudentAssignmentSubmissionChecklist'
import {
  getSubmissionRequirementCompletion,
  isSubmissionArtifactPresent,
} from '@/lib/assignment-submission-requirements'
import type {
  Assignment,
  AssignmentDoc,
  AssignmentDocHistoryEntry,
  AssignmentFeedbackEntry,
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
  TiptapContent,
  UserGitHubIdentity,
} from '@/types'

export interface StudentAssignmentEditorHandle {
  submit: () => Promise<void>
  unsubmit: () => Promise<void>
  isSubmitted: boolean
  canSubmit: boolean
  canUnsubmit: boolean
  submitting: boolean
}

interface Props {
  classroomId: string
  assignmentId: string
  variant?: 'standalone' | 'embedded'
  onExit?: () => void
  onStateChange?: (state: { isSubmitted: boolean; canSubmit: boolean; canUnsubmit: boolean; submitting: boolean }) => void
}

type AssignmentDocResponse = {
  assignment: Assignment
  doc: AssignmentDoc | null
  feedback_entries?: AssignmentFeedbackEntry[]
  submission_requirements?: AssignmentSubmissionRequirement[]
  submission_artifacts?: AssignmentSubmissionArtifact[]
  github_identity?: UserGitHubIdentity | null
  wasFirstView?: boolean
  student_id?: string
}

type AssignmentDocHistoryResponse = {
  history?: AssignmentDocHistoryEntry[]
}

type SaveAttempt = {
  content: TiptapContent
  sessionId: string
  sequence: number
  metricSessionId: string
  expectedUpdatedAt: string
  trigger: 'autosave' | 'blur'
  pasteWordCount: number
  keystrokeCount: number
}

type AssignmentRecoveryDraft = {
  draft_id?: string
  generation?: number
  content?: TiptapContent
  base_revision?: string | null
  save_session_id?: string
  paste_word_count?: number
  keystroke_count?: number
  pending_save?: SaveAttempt
  saved_at?: string
}

type AssignmentTabWriter = {
  session_id: string
  sequence: number
}

const RECOVERY_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PASTE_WORD_COUNT = 32_767
const MAX_KEYSTROKE_COUNT = 2_147_483_647

function compareRecoveryDrafts(a: AssignmentRecoveryDraft, b: AssignmentRecoveryDraft): number {
  const aTime = a.saved_at ? Date.parse(a.saved_at) : Number.NEGATIVE_INFINITY
  const bTime = b.saved_at ? Date.parse(b.saved_at) : Number.NEGATIVE_INFINITY
  const aGeneration = Number.isFinite(a.generation) ? a.generation! : aTime * 1_000
  const bGeneration = Number.isFinite(b.generation) ? b.generation! : bTime * 1_000
  if (aGeneration !== bGeneration) return aGeneration - bGeneration
  if (aTime !== bTime) return aTime - bTime
  return (a.draft_id ?? '').localeCompare(b.draft_id ?? '')
}

function isExpiredRecoveryDraft(draft: AssignmentRecoveryDraft): boolean {
  if (!draft.saved_at) return true
  const savedAt = Date.parse(draft.saved_at)
  return !Number.isFinite(savedAt) || Date.now() - savedAt > RECOVERY_DRAFT_MAX_AGE_MS
}

function saveAttemptBody(attempt: SaveAttempt) {
  return {
    content: attempt.content,
    trigger: attempt.trigger,
    paste_word_count: attempt.pasteWordCount,
    keystroke_count: attempt.keystrokeCount,
    save_session_id: attempt.sessionId,
    save_sequence: attempt.sequence,
    metric_session_id: attempt.metricSessionId,
    expected_updated_at: attempt.expectedUpdatedAt,
  }
}

function isSaveAttempt(value: unknown): value is SaveAttempt {
  if (!value || typeof value !== 'object') return false
  const attempt = value as Partial<SaveAttempt>
  return isValidTiptapContent(attempt.content)
    && typeof attempt.sessionId === 'string' && UUID_PATTERN.test(attempt.sessionId)
    && Number.isInteger(attempt.sequence) && (attempt.sequence ?? 0) > 0
    && typeof attempt.metricSessionId === 'string' && UUID_PATTERN.test(attempt.metricSessionId)
    && typeof attempt.expectedUpdatedAt === 'string' && Number.isFinite(Date.parse(attempt.expectedUpdatedAt))
    && (attempt.trigger === 'autosave' || attempt.trigger === 'blur')
    && Number.isInteger(attempt.pasteWordCount)
    && (attempt.pasteWordCount ?? -1) >= 0
    && (attempt.pasteWordCount ?? Number.POSITIVE_INFINITY) <= MAX_PASTE_WORD_COUNT
    && Number.isInteger(attempt.keystrokeCount)
    && (attempt.keystrokeCount ?? -1) >= 0
    && (attempt.keystrokeCount ?? Number.POSITIVE_INFINITY) <= MAX_KEYSTROKE_COUNT
}

function isAssignmentTabWriter(value: unknown): value is AssignmentTabWriter {
  if (!value || typeof value !== 'object') return false
  const writer = value as Partial<AssignmentTabWriter>
  return typeof writer.session_id === 'string'
    && UUID_PATTERN.test(writer.session_id)
    && Number.isInteger(writer.sequence)
    && (writer.sequence ?? -1) >= 0
}

function isAmbiguousSaveStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429
}

async function fetchJsonWithTimeout<T = any>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<{ response: Response; payload: T }> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal })
        const payload = await response.json() as T
        return { response, payload }
      })(),
      timeout,
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export const StudentAssignmentEditor = forwardRef<StudentAssignmentEditorHandle, Props>(function StudentAssignmentEditor({
  classroomId,
  assignmentId,
  variant = 'standalone',
  onExit,
  onStateChange,
}, ref) {
  const router = useRouter()
  const notifications = useStudentNotifications()
  const isEmbedded = variant === 'embedded'

  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000
  const SAVE_REQUEST_TIMEOUT_MS = 15000
  const KEEPALIVE_BODY_LIMIT_BYTES = 60 * 1024

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [doc, setDoc] = useState<AssignmentDoc | null>(null)
  const isSubmittedRef = useRef(false)
  isSubmittedRef.current = Boolean(doc?.is_submitted)
  const [feedbackEntries, setFeedbackEntries] = useState<AssignmentFeedbackEntry[]>([])
  const [submissionRequirements, setSubmissionRequirements] = useState<AssignmentSubmissionRequirement[]>([])
  const [submissionArtifacts, setSubmissionArtifacts] = useState<AssignmentSubmissionArtifact[]>([])
  const [githubIdentity, setGithubIdentity] = useState<UserGitHubIdentity | null>(null)
  const [content, setContent] = useState<TiptapContent>({ type: 'doc', content: [] })
  const [preservedRecoveryContent, setPreservedRecoveryContent] = useState<TiptapContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [historyEntries, setHistoryEntries] = useState<AssignmentDocHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [previewEntry, setPreviewEntry] = useState<AssignmentDocHistoryEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<TiptapContent | null>(null)
  const [lockedEntryId, setLockedEntryId] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(true)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // Save state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [submitting, setSubmitting] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const lastSavedRevisionRef = useRef<string | null>(null)
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const pendingContentRef = useRef<TiptapContent | null>(null)
  const inFlightSaveRef = useRef<SaveAttempt | null>(null)
  const uncertainSaveRef = useRef<SaveAttempt | null>(null)
  const activeSaveControllerRef = useRef<AbortController | null>(null)
  const saveSessionIdRef = useRef(globalThis.crypto.randomUUID())
  const metricSessionIdRef = useRef(globalThis.crypto.randomUUID())
  const claimedRecoveryDraftRef = useRef<AssignmentRecoveryDraft | null>(null)
  const recoveryGenerationRef = useRef(0)
  const saveSequenceRef = useRef(0)
  const shouldReplayRecoveredSaveRef = useRef(false)
  const pageHiddenRef = useRef(false)
  const studentIdRef = useRef<string | null>(null)
  const draftBeforePreviewRef = useRef<TiptapContent | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const isMountedRef = useRef(true)

  // Input tracking for authenticity
  const pasteWordCountRef = useRef(0)
  const keystrokeCountRef = useRef(0)

  const getDraftStorageKey = useCallback(() => {
    const studentId = studentIdRef.current
    return studentId ? `assignment-draft:${studentId}:${assignmentId}` : null
  }, [assignmentId])

  const getTabWriterStorageKey = useCallback(() => {
    const studentId = studentIdRef.current
    return studentId ? `assignment-save-writer:${studentId}:${assignmentId}` : null
  }, [assignmentId])

  const persistTabWriter = useCallback(() => {
    const key = getTabWriterStorageKey()
    if (!key) return
    safeSessionSetJson(key, {
      session_id: saveSessionIdRef.current,
      sequence: saveSequenceRef.current,
    } satisfies AssignmentTabWriter)
  }, [getTabWriterStorageKey])

  const restoreTabWriter = useCallback(() => {
    const key = getTabWriterStorageKey()
    const writer = key ? safeSessionGetJson<AssignmentTabWriter>(key) : null
    if (isAssignmentTabWriter(writer)) {
      saveSessionIdRef.current = writer.session_id
      saveSequenceRef.current = writer.sequence
      return
    }
    persistTabWriter()
  }, [getTabWriterStorageKey, persistTabWriter])

  const nextSaveSequence = useCallback(() => {
    saveSequenceRef.current += 1
    persistTabWriter()
    return saveSequenceRef.current
  }, [persistTabWriter])

  const readRecoveryDraft = useCallback(() => {
    const key = getDraftStorageKey()
    if (!key) return null

    let sessionDraft = safeSessionGetJson<AssignmentRecoveryDraft>(key)
    let durableDraft = safeLocalGetJson<AssignmentRecoveryDraft>(key)
    if (sessionDraft && isExpiredRecoveryDraft(sessionDraft)) {
      safeSessionRemove(key)
      sessionDraft = null
    }
    if (durableDraft && isExpiredRecoveryDraft(durableDraft)) {
      safeLocalRemove(key)
      durableDraft = null
    }

    const selected = sessionDraft && durableDraft
      ? (compareRecoveryDrafts(sessionDraft, durableDraft) >= 0 ? sessionDraft : durableDraft)
      : sessionDraft ?? durableDraft
    if (selected) {
      const selectedTime = selected.saved_at ? Date.parse(selected.saved_at) : 0
      recoveryGenerationRef.current = Math.max(
        recoveryGenerationRef.current,
        selected.generation ?? selectedTime * 1_000,
      )
    }
    claimedRecoveryDraftRef.current = selected
    return selected
  }, [getDraftStorageKey])

  const persistLocalDraft = useCallback((draft: TiptapContent, pendingSave?: SaveAttempt) => {
    const key = getDraftStorageKey()
    if (!key) return null
    const existingSession = safeSessionGetJson<AssignmentRecoveryDraft>(key)
    const existingDurable = safeLocalGetJson<AssignmentRecoveryDraft>(key)
    const monotonicNow = Math.floor(
      ((globalThis.performance?.timeOrigin ?? Date.now()) + (globalThis.performance?.now?.() ?? 0)) * 1_000
    )
    const nextGeneration = Math.max(
      monotonicNow,
      recoveryGenerationRef.current + 1,
      (existingSession?.generation ?? 0) + 1,
      (existingDurable?.generation ?? 0) + 1,
    )
    recoveryGenerationRef.current = nextGeneration
    const recoveryDraft: AssignmentRecoveryDraft = {
      draft_id: globalThis.crypto.randomUUID(),
      generation: nextGeneration,
      content: draft,
      base_revision: lastSavedRevisionRef.current,
      save_session_id: saveSessionIdRef.current,
      paste_word_count: pasteWordCountRef.current,
      keystroke_count: keystrokeCountRef.current,
      ...(pendingSave ? { pending_save: pendingSave } : {}),
      saved_at: new Date().toISOString(),
    }
    claimedRecoveryDraftRef.current = recoveryDraft
    const sessionSaved = existingSession && compareRecoveryDrafts(existingSession, recoveryDraft) > 0
      ? true
      : safeSessionSetJson(key, recoveryDraft)
    const durableSaved = existingDurable && compareRecoveryDrafts(existingDurable, recoveryDraft) > 0
      ? true
      : safeLocalSetJson(key, recoveryDraft)
    if (!sessionSaved && !durableSaved && isMountedRef.current) {
      setSaveError('This browser could not store a local recovery copy. Keep this tab open until saving succeeds.')
    }
    return recoveryDraft
  }, [getDraftStorageKey])

  const clearLocalDraft = useCallback((completedDraft?: AssignmentRecoveryDraft | null) => {
    const key = getDraftStorageKey()
    const claimedDraft = completedDraft ?? claimedRecoveryDraftRef.current
    if (key && claimedDraft) {
      const sessionDraft = safeSessionGetJson<AssignmentRecoveryDraft>(key)
      const durableDraft = safeLocalGetJson<AssignmentRecoveryDraft>(key)
      if (sessionDraft && compareRecoveryDrafts(sessionDraft, claimedDraft) <= 0) {
        safeSessionRemove(key)
      }
      if (durableDraft && compareRecoveryDrafts(durableDraft, claimedDraft) <= 0) {
        safeLocalRemove(key)
      }
    }
    if (
      !completedDraft
      || claimedRecoveryDraftRef.current?.draft_id === completedDraft.draft_id
    ) {
      claimedRecoveryDraftRef.current = null
    }
  }, [getDraftStorageKey])

  const loadAssignment = useCallback(async () => {
    setLoading(true)
    setError('')
    setSaveError('')
    try {
      const data = await fetchJSONWithCache<AssignmentDocResponse>(
        `assignment-doc:${assignmentId}`,
        async () => {
          const response = await fetch(`/api/assignment-docs/${assignmentId}`)
          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || 'Failed to load assignment')
          }

          return data
        },
        0,
      )

      setAssignment(data.assignment)
      setDoc(data.doc)
      setFeedbackEntries(data.feedback_entries || [])
      setSubmissionRequirements(data.submission_requirements || [])
      setSubmissionArtifacts(data.submission_artifacts || [])
      setGithubIdentity(data.github_identity || null)
      studentIdRef.current = data.doc?.student_id ?? data.student_id ?? null
      restoreTabWriter()
      const serverContent = data.doc?.content || { type: 'doc', content: [] }
      const serverContentStr = JSON.stringify(serverContent)
      lastSavedRevisionRef.current = data.doc?.updated_at ?? null
      lastSavedContentRef.current = serverContentStr
      const localDraft = readRecoveryDraft()
      const recoveredContent = localDraft?.content
      const recoveredContentStr = recoveredContent ? JSON.stringify(recoveredContent) : null
      pasteWordCountRef.current = Math.max(0, localDraft?.paste_word_count ?? 0)
      keystrokeCountRef.current = Math.max(0, localDraft?.keystroke_count ?? 0)
      const recoveredPendingSave = isSaveAttempt(localDraft?.pending_save)
        ? localDraft.pending_save
        : null
      uncertainSaveRef.current = recoveredPendingSave
      shouldReplayRecoveredSaveRef.current = false
      if (!data.doc?.is_submitted && recoveredContent && recoveredContentStr !== serverContentStr) {
        setPreservedRecoveryContent(null)
        setContent(recoveredContent)
        pendingContentRef.current = recoveredContent
        setSaveStatus('unsaved')
        if (localDraft.base_revision !== lastSavedRevisionRef.current) {
          setSaveError('A local draft was recovered after the saved version changed. Review it before continuing.')
        }
      } else if (data.doc?.is_submitted && recoveredContent && recoveredContentStr !== serverContentStr) {
        setPreservedRecoveryContent(recoveredContent)
        setContent(serverContent)
        pendingContentRef.current = serverContent
        setSaveStatus('saved')
        setSaveError(
          canUnsubmitAssignmentDoc(data.doc)
            ? 'A newer local draft is preserved in this browser. Unsubmit to restore and review it.'
            : 'A newer local draft is preserved below for review. This returned submission cannot be unsubmitted.'
        )
      } else {
        setPreservedRecoveryContent(null)
        setContent(serverContent)
        pendingContentRef.current = serverContent
        if (!data.doc?.is_submitted && recoveredPendingSave) {
          shouldReplayRecoveredSaveRef.current = true
          setSaveStatus('unsaved')
          setSaveError('Confirming the last save from this browser...')
        } else {
          clearLocalDraft(localDraft)
        }
      }

      // Decrement notification count only if this was the first view (server confirmed)
      if (data.wasFirstView) {
        notifications?.decrementUnviewedCount()
      }
    } catch (err: any) {
      console.error('Error loading assignment:', err)
      setError(err.message || 'Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }, [assignmentId, clearLocalDraft, notifications, readRecoveryDraft, restoreTabWriter])

  const applyUnsubmittedDoc = useCallback((nextDoc: AssignmentDoc) => {
    const serverContent = nextDoc.content || { type: 'doc', content: [] }
    const serverContentStr = JSON.stringify(serverContent)
    setDoc(nextDoc)
    setPreservedRecoveryContent(null)
    lastSavedContentRef.current = serverContentStr
    lastSavedRevisionRef.current = nextDoc.updated_at ?? null

    const recoveryDraft = readRecoveryDraft()
    if (recoveryDraft?.content && JSON.stringify(recoveryDraft.content) !== serverContentStr) {
      setContent(recoveryDraft.content)
      pendingContentRef.current = recoveryDraft.content
      setSaveStatus('unsaved')
      setSaveError('Your preserved local draft was restored after unsubmit. Review it before saving.')
      return
    }

    setContent(serverContent)
    pendingContentRef.current = serverContent
    setSaveStatus('saved')
    setSaveError('')
    clearLocalDraft()
  }, [clearLocalDraft, readRecoveryDraft])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const data = await fetchJSONWithCache<AssignmentDocHistoryResponse>(
        `assignment-doc-history:${assignmentId}`,
        async () => {
          const response = await fetch(`/api/assignment-docs/${assignmentId}/history`)
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || 'Failed to load history')
          }
          return data
        },
        0,
      )
      setHistoryEntries(data.history || [])
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }, [assignmentId])

  const refreshAfterRevisionConflict = useCallback(async (localDraft: TiptapContent) => {
    try {
      const data = await fetchJSONWithCache<AssignmentDocResponse>(
        `assignment-doc:${assignmentId}`,
        async () => {
          const { response, payload } = await fetchJsonWithTimeout<AssignmentDocResponse>(
            `/api/assignment-docs/${assignmentId}`,
            {},
            SAVE_REQUEST_TIMEOUT_MS,
            'Reloading the saved assignment timed out.',
          )
          if (!response.ok) {
            throw new Error((payload as any).error || 'Failed to reload assignment')
          }
          return payload
        },
        0,
      )
      if (!data.doc) return false

      const serverContent = data.doc.content || { type: 'doc', content: [] }
      const draftToPreserve = pendingContentRef.current ?? localDraft
      setDoc(data.doc)
      lastSavedContentRef.current = JSON.stringify(serverContent)
      lastSavedRevisionRef.current = data.doc.updated_at ?? null
      if (data.doc.is_submitted) {
        if (JSON.stringify(draftToPreserve) !== lastSavedContentRef.current) {
          persistLocalDraft(draftToPreserve, uncertainSaveRef.current ?? undefined)
          setPreservedRecoveryContent(draftToPreserve)
        }
        setContent(serverContent)
        pendingContentRef.current = serverContent
        setSaveStatus('saved')
        setSaveError(
          canUnsubmitAssignmentDoc(data.doc)
            ? 'This assignment was submitted in another tab. Unsubmit it before editing again.'
            : 'This assignment was submitted and returned while this tab had newer work. The preserved draft is available below for review.'
        )
        await loadHistory()
        return true
      }
      setPreservedRecoveryContent(null)
      setContent(draftToPreserve)
      pendingContentRef.current = draftToPreserve
      setSaveStatus(
        JSON.stringify(draftToPreserve) === lastSavedContentRef.current
          ? 'saved'
          : 'unsaved'
      )
      await loadHistory()
      return true
    } catch (refreshError) {
      console.error('Error refreshing assignment after revision conflict:', refreshError)
      return false
    }
  }, [SAVE_REQUEST_TIMEOUT_MS, assignmentId, loadHistory, persistLocalDraft])

  useEffect(() => {
    loadAssignment()
    loadHistory()
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
      }
    }
  }, [loadAssignment, loadHistory])

  // Autosave with debouncing
  const saveContent = useCallback((
    newContent: TiptapContent,
    options?: { trigger?: 'autosave' | 'blur' }
  ) => {
    const savePromise = saveQueueRef.current.then(async () => {
      if (pageHiddenRef.current) return
      const newContentStr = JSON.stringify(newContent)
      const hasPendingMetrics = pasteWordCountRef.current > 0 || keystrokeCountRef.current > 0
      if (newContentStr === lastSavedContentRef.current && !hasPendingMetrics) {
        if (isMountedRef.current) {
          const pendingContent = pendingContentRef.current
          const hasNewerPendingContent = Boolean(
            pendingContent && JSON.stringify(pendingContent) !== newContentStr
          )
          setSaveStatus(hasNewerPendingContent ? 'unsaved' : 'saved')
          if (!hasNewerPendingContent) setSaveError('')
        }
        return
      }

      if (isMountedRef.current) {
        setSaveStatus('saving')
        setSaveError('')
      }
      lastSaveAttemptAtRef.current = Date.now()
      const pasteWordCount = pasteWordCountRef.current
      const keystrokeCount = keystrokeCountRef.current
      const uncertainSave = uncertainSaveRef.current
      const isExactUncertainRetry = Boolean(
        uncertainSave
        && JSON.stringify(uncertainSave.content) === newContentStr
        && uncertainSave.pasteWordCount === pasteWordCount
        && uncertainSave.keystrokeCount === keystrokeCount
      )
      const expectedUpdatedAt = lastSavedRevisionRef.current
      if (!expectedUpdatedAt) {
        throw new Error('The saved draft revision is unavailable. Reload this assignment before retrying.')
      }
      const saveAttempt: SaveAttempt = isExactUncertainRetry
        ? uncertainSave!
        : {
            content: newContent,
            sessionId: saveSessionIdRef.current,
            sequence: nextSaveSequence(),
            metricSessionId: uncertainSave?.metricSessionId ?? metricSessionIdRef.current,
            expectedUpdatedAt,
            trigger: options?.trigger ?? 'autosave',
            pasteWordCount,
            keystrokeCount,
          }
      const controller = new AbortController()
      let didTimeOut = false
      let hasDefinitiveResponse = false
      const timeoutId = setTimeout(() => {
        didTimeOut = true
        controller.abort()
      }, SAVE_REQUEST_TIMEOUT_MS)
      activeSaveControllerRef.current = controller
      inFlightSaveRef.current = saveAttempt
      const attemptRecoveryDraft = persistLocalDraft(newContent, saveAttempt)

      try {
        const response = await fetch(`/api/assignment-docs/${assignmentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saveAttemptBody(saveAttempt)),
          signal: controller.signal,
        })

        hasDefinitiveResponse = response.ok || !isAmbiguousSaveStatus(response.status)
        const data = await response.json()

        if (!response.ok) {
          if (data.error_code === 'assignment_doc_save_replayed' && isExactUncertainRetry) {
            pasteWordCountRef.current = Math.max(
              0,
              pasteWordCountRef.current - saveAttempt.pasteWordCount
            )
            keystrokeCountRef.current = Math.max(
              0,
              keystrokeCountRef.current - saveAttempt.keystrokeCount
            )
            if (
              uncertainSaveRef.current?.sessionId === saveAttempt.sessionId
              && uncertainSaveRef.current.sequence === saveAttempt.sequence
            ) {
              uncertainSaveRef.current = null
            }
            metricSessionIdRef.current = globalThis.crypto.randomUUID()
            const refreshed = await refreshAfterRevisionConflict(newContent)
            if (!refreshed) {
              throw new Error('The saved version could not be reloaded. Reload this assignment before retrying.')
            }
            if (JSON.stringify(newContent) !== lastSavedContentRef.current) {
              throw new Error('A newer saved version exists. Review your preserved draft before retrying.')
            }
            clearLocalDraft(attemptRecoveryDraft)
            return
          }
          if (
            hasDefinitiveResponse
            && isExactUncertainRetry
            && uncertainSaveRef.current?.sessionId === saveAttempt.sessionId
            && uncertainSaveRef.current.sequence === saveAttempt.sequence
          ) {
            uncertainSaveRef.current = null
          }
          if (response.status === 409 || response.status === 403) {
            const refreshed = await refreshAfterRevisionConflict(newContent)
            if (!refreshed) {
              throw new Error('The saved version could not be reloaded. Reload this assignment before retrying.')
            }
            if (response.status === 403) {
              throw new Error('This assignment was submitted in another tab. Your local draft is preserved for review.')
            }
          }
          throw new Error(data.error || 'Failed to save')
        }
        hasDefinitiveResponse = true

        const historyEntry = data.historyEntry as AssignmentDocHistoryEntry | null | undefined

        if (isMountedRef.current) {
          setDoc(data.doc)
          if (historyEntry) {
            setHistoryEntries(prev => {
              const existingIndex = prev.findIndex(entry => entry.id === historyEntry.id)
              const next = existingIndex === -1 ? [historyEntry, ...prev] : [...prev]

              if (existingIndex !== -1) {
                next[existingIndex] = historyEntry
              }

              return next.sort((a, b) => b.created_at.localeCompare(a.created_at))
            })
            setPreviewEntry(prev => (prev?.id === historyEntry.id ? historyEntry : prev))
          }
          const pendingContent = pendingContentRef.current
          setSaveStatus(
            pendingContent && JSON.stringify(pendingContent) !== newContentStr
              ? 'unsaved'
              : 'saved'
          )
        }
        lastSavedContentRef.current = newContentStr
        lastSavedRevisionRef.current = data.doc?.updated_at ?? lastSavedRevisionRef.current
        if (
          uncertainSaveRef.current?.sessionId === uncertainSave?.sessionId
          && uncertainSaveRef.current?.sequence === uncertainSave?.sequence
        ) {
          uncertainSaveRef.current = null
        }
        pasteWordCountRef.current = Math.max(0, pasteWordCountRef.current - saveAttempt.pasteWordCount)
        keystrokeCountRef.current = Math.max(0, keystrokeCountRef.current - saveAttempt.keystrokeCount)
        metricSessionIdRef.current = globalThis.crypto.randomUUID()
        if (pendingContentRef.current && JSON.stringify(pendingContentRef.current) === newContentStr) {
          clearLocalDraft(attemptRecoveryDraft)
        }
      } catch (err: any) {
        if (!hasDefinitiveResponse) {
          const currentUncertain = uncertainSaveRef.current
          if (
            !currentUncertain
            || currentUncertain.sessionId !== saveAttempt.sessionId
            || currentUncertain.sequence <= saveAttempt.sequence
          ) {
            uncertainSaveRef.current = saveAttempt
            persistLocalDraft(newContent, saveAttempt)
          }
        } else if (!isSubmittedRef.current) {
          persistLocalDraft(newContent, uncertainSaveRef.current ?? undefined)
        }
        const saveError = didTimeOut
          ? new Error('Save timed out. Check your connection and try again.')
          : err
        console.error('Error saving:', saveError)
        if (isMountedRef.current) {
          setSaveStatus('unsaved')
          setSaveError(saveError.message || 'Failed to save')
        }
        throw saveError
      } finally {
        clearTimeout(timeoutId)
        if (activeSaveControllerRef.current === controller) {
          activeSaveControllerRef.current = null
        }
        if (
          inFlightSaveRef.current?.sessionId === saveAttempt.sessionId
          && inFlightSaveRef.current.sequence === saveAttempt.sequence
        ) {
          inFlightSaveRef.current = null
        }
      }
    })

    saveQueueRef.current = savePromise.catch(() => undefined)
    return savePromise
  }, [
    SAVE_REQUEST_TIMEOUT_MS,
    assignmentId,
    clearLocalDraft,
    nextSaveSequence,
    persistLocalDraft,
    refreshAfterRevisionConflict,
  ])

  useEffect(() => {
    if (
      loading
      || doc?.is_submitted
      || !shouldReplayRecoveredSaveRef.current
      || !uncertainSaveRef.current
    ) {
      return
    }

    shouldReplayRecoveredSaveRef.current = false
    const recoveredAttempt = uncertainSaveRef.current
    void saveContent(recoveredAttempt.content, { trigger: recoveredAttempt.trigger }).catch(() => undefined)
  }, [doc?.is_submitted, loading, saveContent])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (throttledSaveTimeoutRef.current) clearTimeout(throttledSaveTimeoutRef.current)
      activeSaveControllerRef.current?.abort()

      const latest = pendingContentRef.current
      if (
        latest
        && !isSubmittedRef.current
        && (
          JSON.stringify(latest) !== lastSavedContentRef.current
          || pasteWordCountRef.current > 0
          || keystrokeCountRef.current > 0
        )
      ) {
        void saveContent(latest, { trigger: 'blur' }).catch(() => undefined)
      }
    }
  }, [saveContent])

  useEffect(() => {
    const handlePageHide = () => {
      pageHiddenRef.current = true
      const latest = pendingContentRef.current
      const inFlightSave = inFlightSaveRef.current
      const saveToSupersede = inFlightSave ?? uncertainSaveRef.current
      const latestStr = latest ? JSON.stringify(latest) : null
      const inFlightStr = inFlightSave ? JSON.stringify(inFlightSave.content) : null
      if (
        !latest
        || isSubmittedRef.current
        || (
          latestStr === lastSavedContentRef.current
          && (!inFlightSave || inFlightStr === latestStr)
          && pasteWordCountRef.current === 0
          && keystrokeCountRef.current === 0
        )
      ) {
        return
      }

      const saveSequence = nextSaveSequence()
      const pagehidePasteWordCount = pasteWordCountRef.current
      const pagehideKeystrokeCount = keystrokeCountRef.current
      const expectedUpdatedAt = lastSavedRevisionRef.current
      if (!expectedUpdatedAt) {
        persistLocalDraft(latest, saveToSupersede ?? undefined)
        return
      }
      const pagehideAttempt: SaveAttempt = {
        content: latest,
        sessionId: saveSessionIdRef.current,
        sequence: saveSequence,
        metricSessionId: saveToSupersede?.metricSessionId ?? metricSessionIdRef.current,
        expectedUpdatedAt,
        trigger: 'blur',
        pasteWordCount: pagehidePasteWordCount,
        keystrokeCount: pagehideKeystrokeCount,
      }
      const body = JSON.stringify(saveAttemptBody(pagehideAttempt))
      activeSaveControllerRef.current?.abort()
      if (new TextEncoder().encode(body).byteLength > KEEPALIVE_BODY_LIMIT_BYTES) {
        persistLocalDraft(latest, saveToSupersede ?? undefined)
        return
      }

      uncertainSaveRef.current = pagehideAttempt
      const attemptRecoveryDraft = persistLocalDraft(latest, pagehideAttempt)
      void fetch(`/api/assignment-docs/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body,
      }).then(async (response) => {
        if (!response.ok) return
        const data = await response.json()
        const responseRevision = data.doc?.updated_at
        if (typeof responseRevision !== 'string') return
        if (
          uncertainSaveRef.current?.sessionId !== pagehideAttempt.sessionId
          || uncertainSaveRef.current.sequence !== saveSequence
        ) {
          return
        }

        pasteWordCountRef.current = Math.max(
          0,
          pasteWordCountRef.current - pagehidePasteWordCount
        )
        keystrokeCountRef.current = Math.max(
          0,
          keystrokeCountRef.current - pagehideKeystrokeCount
        )
        metricSessionIdRef.current = globalThis.crypto.randomUUID()
        uncertainSaveRef.current = null
        if (
          !lastSavedRevisionRef.current
          || responseRevision >= lastSavedRevisionRef.current
        ) {
          lastSavedRevisionRef.current = responseRevision
          lastSavedContentRef.current = latestStr ?? lastSavedContentRef.current
        }
        if (
          pendingContentRef.current
          && JSON.stringify(pendingContentRef.current) === latestStr
        ) {
          clearLocalDraft(attemptRecoveryDraft)
        }
      }).catch(() => undefined)
    }

    const handlePageShow = () => {
      pageHiddenRef.current = false
      const latest = pendingContentRef.current
      if (latest && !isSubmittedRef.current) {
        void refreshAfterRevisionConflict(latest).then((refreshed) => {
          if (!refreshed && isMountedRef.current) {
            setSaveError('The latest saved version could not be loaded. Reload this assignment before retrying.')
          }
        })
      }
    }

    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [
    KEEPALIVE_BODY_LIMIT_BYTES,
    assignmentId,
    clearLocalDraft,
    nextSaveSequence,
    persistLocalDraft,
    refreshAfterRevisionConflict,
  ])

  const scheduleSave = useCallback((
    newContent: TiptapContent,
    options?: { force?: boolean; trigger?: 'autosave' | 'blur' }
  ) => {
    pendingContentRef.current = newContent

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastAttempt = now - lastSaveAttemptAtRef.current

    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      void saveContent(newContent, { trigger: options?.trigger }).catch(() => undefined)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingContentRef.current
      if (latest) {
        void saveContent(latest, { trigger: options?.trigger }).catch(() => undefined)
      }
    }, waitMs)
  }, [AUTOSAVE_MIN_INTERVAL_MS, saveContent])

  function handleContentChange(newContent: TiptapContent) {
    if (previewEntry) return
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent
    persistLocalDraft(newContent, uncertainSaveRef.current ?? undefined)

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(newContent, { trigger: 'autosave' })
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function flushAutosave() {
    const latest = pendingContentRef.current ?? content
    if (
      JSON.stringify(latest) !== lastSavedContentRef.current
      || pasteWordCountRef.current > 0
      || keystrokeCountRef.current > 0
    ) {
      scheduleSave(latest, { force: true, trigger: 'blur' })
    }
  }

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setError('')
    const submissionContent = pendingContentRef.current ?? content

    try {
      try {
        await saveContent(submissionContent, { trigger: 'autosave' })
      } catch (saveFailure: any) {
        setSaveError(
          `Your latest changes could not be saved, so this assignment was not submitted. ${
            saveFailure?.message || 'Save failed.'
          } Try again.`
        )
        return
      }

      const expectedUpdatedAt = lastSavedRevisionRef.current
      if (!expectedUpdatedAt) {
        setSaveError('Your saved draft revision could not be verified, so this assignment was not submitted. Try again.')
        return
      }

      const { response, payload: data } = await fetchJsonWithTimeout<any>(`/api/assignment-docs/${assignmentId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: submissionContent,
          expected_updated_at: expectedUpdatedAt,
        }),
      }, SAVE_REQUEST_TIMEOUT_MS, 'Submission timed out. Check your connection and try again.')

      if (!response.ok) {
        if (response.status === 409) {
          const refreshed = await refreshAfterRevisionConflict(submissionContent)
          if (!refreshed) {
            throw new Error('The saved version could not be reloaded. Reload this assignment before retrying.')
          }
        }
        throw new Error(data.error || 'Failed to submit')
      }

      setDoc(data.doc)
      lastSavedContentRef.current = JSON.stringify(submissionContent)
      lastSavedRevisionRef.current = data.doc?.updated_at ?? lastSavedRevisionRef.current
      setSaveStatus('saved')
      setSaveError('')
      clearLocalDraft()
    } catch (err: any) {
      console.error('Error submitting:', err)
      try {
        const { response: refreshResponse, payload: refreshData } = await fetchJsonWithTimeout<any>(
          `/api/assignment-docs/${assignmentId}`,
          { method: 'GET', cache: 'no-store' },
          SAVE_REQUEST_TIMEOUT_MS,
          'Submission status check timed out.'
        )
        if (refreshResponse.ok && refreshData.doc?.is_submitted) {
          const submittedDoc = refreshData.doc as AssignmentDoc
          const serverContent = submittedDoc.content || { type: 'doc', content: [] }
          const serverContentStr = JSON.stringify(serverContent)
          const latestLocalContent = pendingContentRef.current ?? submissionContent
          setDoc(submittedDoc)
          setContent(serverContent)
          pendingContentRef.current = serverContent
          lastSavedContentRef.current = serverContentStr
          lastSavedRevisionRef.current = submittedDoc.updated_at ?? lastSavedRevisionRef.current
          setSaveStatus('saved')
          if (serverContentStr === JSON.stringify(latestLocalContent)) {
            setSaveError('')
            setPreservedRecoveryContent(null)
            clearLocalDraft()
          } else {
            persistLocalDraft(latestLocalContent, uncertainSaveRef.current ?? undefined)
            setPreservedRecoveryContent(latestLocalContent)
            setSaveError(
              canUnsubmitAssignmentDoc(submittedDoc)
                ? 'Another tab submitted different work. Your local draft is preserved; unsubmit to review it.'
                : 'Another tab submitted different work. Your local draft is preserved below for review.'
            )
          }
          setError('')
          return
        }
      } catch (refreshError) {
        console.error('Error reconciling assignment after submit:', refreshError)
      }
      setError(err.message || 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }, [SAVE_REQUEST_TIMEOUT_MS, assignmentId, clearLocalDraft, content, persistLocalDraft, refreshAfterRevisionConflict, saveContent])

  const handleUnsubmit = useCallback(async () => {
    setSubmitting(true)

    try {
      const { response, payload: data } = await fetchJsonWithTimeout<any>(`/api/assignment-docs/${assignmentId}/unsubmit`, {
        method: 'POST'
      }, SAVE_REQUEST_TIMEOUT_MS, 'Unsubmit timed out. Check your connection and try again.')

      if (!response.ok) {
        throw new Error(data.error || 'Failed to unsubmit')
      }

      applyUnsubmittedDoc(data.doc)
      setError('')
    } catch (err: any) {
      console.error('Error unsubmitting:', err)
      try {
        const { response: refreshResponse, payload: refreshData } = await fetchJsonWithTimeout<any>(
          `/api/assignment-docs/${assignmentId}`,
          { method: 'GET', cache: 'no-store' },
          SAVE_REQUEST_TIMEOUT_MS,
          'Unsubmit status check timed out.'
        )
        if (refreshResponse.ok && refreshData.doc && !refreshData.doc.is_submitted) {
          applyUnsubmittedDoc(refreshData.doc)
          setError('')
          return
        }
      } catch (refreshError) {
        console.error('Error reconciling assignment after unsubmit:', refreshError)
      }
      setError(err.message || 'Failed to unsubmit')
    } finally {
      setSubmitting(false)
    }
  }, [SAVE_REQUEST_TIMEOUT_MS, applyUnsubmittedDoc, assignmentId])

  function updatePreview(entry: AssignmentDocHistoryEntry): boolean {
    if (!draftBeforePreviewRef.current) {
      draftBeforePreviewRef.current = JSON.parse(JSON.stringify(content)) as TiptapContent
    }
    // Reconstruct content for this entry (client-side, no API call)
    // API returns newest-first, but reconstruction needs oldest-first
    const oldestFirst = [...historyEntries].reverse()
    const reconstructed = reconstructAssignmentDocContent(oldestFirst, entry.id)

    if (reconstructed) {
      setPreviewEntry(entry)
      setPreviewContent(reconstructed)
      return true
    }
    return false
  }

  function handlePreviewHover(entry: AssignmentDocHistoryEntry) {
    if (lockedEntryId) return
    updatePreview(entry)
  }

  function handlePreviewLock(entry: AssignmentDocHistoryEntry) {
    const success = updatePreview(entry)
    if (success) {
      setLockedEntryId(entry.id)
    }
  }

  function handleHistoryMouseLeave() {
    if (lockedEntryId) return
    handleExitPreview()
  }

  function handleHistoryToggle() {
    if (isHistoryOpen) {
      handleExitPreview()
    }
    setIsHistoryOpen(prev => !prev)
  }

  function handleExitPreview(options?: { restoreDraft?: boolean }) {
    const shouldRestore = options?.restoreDraft !== false
    if (shouldRestore && draftBeforePreviewRef.current) {
      const restoredDraft = draftBeforePreviewRef.current
      setContent(restoredDraft)
      pendingContentRef.current = restoredDraft
      const restoredStr = JSON.stringify(restoredDraft)
      setSaveStatus(restoredStr === lastSavedContentRef.current ? 'saved' : 'unsaved')
    }
    setPreviewEntry(null)
    setPreviewContent(null)
    setShowRestoreModal(false)
    setLockedEntryId(null)
    draftBeforePreviewRef.current = null
  }

  function handleRestoreClick() {
    if (!previewEntry || !lockedEntryId) return
    setShowRestoreModal(true)
  }

  async function confirmRestore() {
    if (!previewEntry) return

    setRestoringId(previewEntry.id)
    setHistoryError('')
    try {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
        throttledSaveTimeoutRef.current = null
      }
      const pendingDraft = pendingContentRef.current
      if (
        pendingDraft
        && (
          JSON.stringify(pendingDraft) !== lastSavedContentRef.current
          || pasteWordCountRef.current > 0
          || keystrokeCountRef.current > 0
        )
      ) {
        await saveContent(pendingDraft, { trigger: 'blur' })
      } else {
        await saveQueueRef.current
      }

      const { response, payload: data } = await fetchJsonWithTimeout<any>(`/api/assignment-docs/${assignmentId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_id: previewEntry.id })
      }, SAVE_REQUEST_TIMEOUT_MS, 'Restore timed out. Check your connection and try again.')
      if (!response.ok) {
        throw new Error(data.error || 'Failed to restore')
      }
      setDoc(data.doc)
      setContent(data.doc?.content || { type: 'doc', content: [] })
      pendingContentRef.current = data.doc?.content || { type: 'doc', content: [] }
      lastSavedContentRef.current = JSON.stringify(data.doc?.content || { type: 'doc', content: [] })
      lastSavedRevisionRef.current = data.doc?.updated_at ?? null
      pasteWordCountRef.current = 0
      keystrokeCountRef.current = 0
      setSaveStatus('saved')
      setSaveError('')
      clearLocalDraft()
      await loadHistory()
      handleExitPreview({ restoreDraft: false })
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to restore')
    } finally {
      setRestoringId(null)
      setShowRestoreModal(false)
    }
  }

  // Compute state for imperative handle (before early returns)
  const submissionCompletion = useMemo(
    () => getSubmissionRequirementCompletion(submissionRequirements, submissionArtifacts),
    [submissionArtifacts, submissionRequirements]
  )
  const hasStructuredSubmissionArtifact = submissionArtifacts.some(isSubmissionArtifactPresent)
  const structuredRequirementsSatisfied = submissionRequirements.length === 0 || submissionCompletion.canSubmit
  const isSubmitted = doc?.is_submitted || false
  const canUnsubmit = canUnsubmitAssignmentDoc(doc)
  const canSubmit = (
    hasAssignmentSubmissionContent({ content }) || hasStructuredSubmissionArtifact
  ) && structuredRequirementsSatisfied && !previewEntry

  // Expose imperative handle for parent components
  useImperativeHandle(ref, () => ({
    submit: handleSubmit,
    unsubmit: handleUnsubmit,
    isSubmitted,
    canSubmit,
    canUnsubmit,
    submitting,
  }), [handleSubmit, handleUnsubmit, isSubmitted, canSubmit, canUnsubmit, submitting])

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({ isSubmitted, canSubmit, canUnsubmit, submitting })
  }, [isSubmitted, canSubmit, canUnsubmit, submitting, onStateChange])

  if (loading) {
    if (isEmbedded) {
      return (
        <Card tone="panel" padding="lg">
          <div className="flex justify-center">
            <Spinner size="lg" />
          </div>
        </Card>
      )
    }
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error && !assignment) {
    const exit = onExit ?? (() => router.push(`/classrooms/${classroomId}?tab=assignments`))
    if (isEmbedded) {
      return (
        <EmptyState
          title="Assignment unavailable"
          description={<span className="text-danger">{error}</span>}
          action={
            <button onClick={exit} className="text-primary hover:text-primary-hover">
              Back to assignments
            </button>
          }
          tone="muted"
        />
      )
    }
    return (
      <EmptyState
        title="Assignment unavailable"
        description={<span className="text-danger">{error}</span>}
        action={
          <button onClick={() => router.back()} className="text-primary hover:text-primary-hover">
            Go back
          </button>
        }
      />
    )
  }

  if (!assignment) {
    return null
  }

  const status = calculateAssignmentStatus(assignment, doc)
  const isPreviewLocked = lockedEntryId !== null
  const hasCompletionScore = doc?.score_completion != null
  const hasThinkingScore = doc?.score_thinking != null
  const hasWorkflowScore = doc?.score_workflow != null
  const hasAnyScore = hasCompletionScore || hasThinkingScore || hasWorkflowScore
  const hasFullScoreSet = hasCompletionScore && hasThinkingScore && hasWorkflowScore
  const feedbackVisible = Boolean(doc?.feedback_returned_at || doc?.returned_at || feedbackEntries.length > 0)
  const displayedFeedbackEntries = feedbackEntries.length > 0
    ? feedbackEntries
    : (doc?.feedback?.trim() && doc.feedback_returned_at
        ? [{
            id: 'latest-feedback',
            assignment_id: assignmentId,
            student_id: doc.student_id,
            entry_kind: doc.returned_at ? 'grading_feedback' : 'teacher_feedback',
            author_type: 'teacher' as const,
            body: doc.feedback.trim(),
            returned_at: doc.feedback_returned_at,
            created_at: doc.feedback_returned_at,
            created_by: null,
          }]
        : [])

  const editorContent = (
    <div className="flex flex-col gap-6 h-full min-h-0">
      {/* Instructions */}
      {!isEmbedded && (assignment.instructions_markdown || assignment.rich_instructions || assignment.description) && (
        <Card tone="muted" padding="md">
          {assignment.instructions_markdown ? (
            <LimitedMarkdown content={assignment.instructions_markdown} />
          ) : assignment.rich_instructions ? (
            <RichTextViewer content={assignment.rich_instructions} />
          ) : (
            <p className="text-text-muted whitespace-pre-wrap">{assignment.description}</p>
          )}
        </Card>
      )}

      {submissionRequirements.length > 0 && (
        <StudentAssignmentSubmissionChecklist
          assignmentId={assignmentId}
          requirements={submissionRequirements}
          artifacts={submissionArtifacts}
          githubIdentity={githubIdentity}
          disabled={isSubmitted || submitting || !!previewEntry}
          onArtifactsChange={setSubmissionArtifacts}
          onError={setError}
        />
      )}

      {/* Editor with History Column */}
      <div className="flex min-h-0 flex-1 flex-col rounded-card border border-border bg-surface-panel shadow-elevated">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-muted truncate">
                {assignment.title}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isEmbedded ? (
                <span data-testid="assignment-status-badge" className={getAssignmentStatusBadgeClass(status)}>
                  {getAssignmentStatusLabel(status)}
                </span>
              ) : null}
              <div
                data-testid="assignment-save-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`text-xs ${
                  saveStatus === 'saved'
                    ? 'text-success'
                    : saveStatus === 'saving'
                      ? 'text-text-muted'
                      : 'text-warning'
                }`}
              >
                {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
              </div>
              <Tooltip content={isHistoryOpen ? 'Hide history' : 'Show history'}>
                <button
                  type="button"
                  onClick={handleHistoryToggle}
                  className="p-1.5 rounded-md border border-border text-text-muted hover:bg-surface-hover"
                  aria-expanded={isHistoryOpen}
                  aria-label={isHistoryOpen ? 'Hide history' : 'Show history'}
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Main Content Area: Editor + History Column */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Editor */}
          <div className={`flex-1 min-h-0 border-b md:border-b-0 border-border flex flex-col ${isHistoryOpen ? 'md:border-r' : ''}`}>
            <div className={previewEntry ? 'ring-2 ring-warning rounded-lg flex-1 min-h-0' : 'flex-1 min-h-0'}>
              <RichTextEditor
                content={previewContent || content}
                onChange={handleContentChange}
                placeholder="Write your response here..."
                disabled={submitting || !!previewEntry}
                editable={!isSubmitted && !previewEntry}
                onBlur={flushAutosave}
                onPaste={(wordCount) => { pasteWordCountRef.current += wordCount }}
                onKeystroke={() => { keystrokeCountRef.current++ }}
                className="h-full"
                enableImageUpload
                onImageUploadError={(message) => setError(message)}
              />
            </div>

            {(saveError || error) && (
              <div className="mt-4">
                {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              </div>
            )}
          </div>

          {/* History Column (Desktop) */}
          {isHistoryOpen && (
            <div
              className="hidden md:flex w-60 bg-page flex-col min-h-0"
              onMouseLeave={handleHistoryMouseLeave}
            >
              <div className="p-3 border-b border-border">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  History
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {historyLoading ? (
                  <div className="p-4 text-center">
                    <Spinner size="sm" />
                  </div>
                ) : historyError ? (
                  <div className="p-4">
                    <p role="alert" className="text-xs text-danger">{historyError}</p>
                  </div>
                ) : historyEntries.length === 0 ? (
                  <div className="p-4">
                    <p className="text-xs text-text-muted">No saves yet</p>
                  </div>
                ) : (
                  <HistoryList
                    entries={historyEntries}
                    activeEntryId={previewEntry?.id ?? null}
                    onEntryClick={handlePreviewLock}
                    onEntryHover={handlePreviewHover}
                  />
                )}
              </div>
              {isPreviewLocked && previewEntry && (
                <div className="px-3 py-3 border-t border-border">
                  <div className="flex flex-col gap-2">
                    {!isSubmitted && (
                      <Button onClick={handleRestoreClick} disabled={restoringId !== null}>
                        {restoringId ? 'Restoring...' : 'Restore'}
                      </Button>
                    )}
                    <Button onClick={() => handleExitPreview()} variant="secondary">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile History Drawer */}
        {isHistoryOpen && (
          <div className="md:hidden border-t border-border">
          <details
            className="group"
            onToggle={(event) => {
              const target = event.currentTarget
              if (!target.open && !lockedEntryId) {
                handleExitPreview()
              }
            }}
          >
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-text-muted hover:bg-surface-hover flex items-center justify-between">
              <span>View History ({historyEntries.length})</span>
              <svg className="w-5 h-5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 pb-4 max-h-80 overflow-y-auto bg-page">
              {historyLoading ? (
                <div className="p-4 text-center">
                  <Spinner size="sm" />
                </div>
              ) : historyError ? (
                <p role="alert" className="text-xs text-danger">{historyError}</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-xs text-text-muted">No saves yet</p>
              ) : (
                <HistoryList
                  entries={historyEntries}
                  activeEntryId={previewEntry?.id ?? null}
                  onEntryClick={handlePreviewLock}
                  variant="mobile"
                />
              )}
              {isPreviewLocked && previewEntry && (
                <div className="pt-4 flex flex-col gap-2">
                  {!isSubmitted && (
                    <Button onClick={handleRestoreClick} disabled={restoringId !== null}>
                      {restoringId ? 'Restoring...' : 'Restore'}
                    </Button>
                  )}
                  <Button onClick={() => handleExitPreview()} variant="secondary">
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </details>
        </div>
        )}
      </div>

      {isSubmitted && !canUnsubmit && preservedRecoveryContent && (
        <section
          aria-labelledby="preserved-assignment-draft-heading"
          className="border-y border-warning/40 bg-warning/10 px-4 py-4"
        >
          <h3 id="preserved-assignment-draft-heading" className="text-sm font-semibold text-text-default">
            Preserved local draft
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            This work was newer than the submitted version. It is read-only because the assignment has been returned.
          </p>
          <div className="mt-3 rounded-md border border-border bg-surface-panel p-3">
            <RichTextViewer content={preservedRecoveryContent} />
          </div>
        </section>
      )}

      <ConfirmDialog
        isOpen={showRestoreModal && Boolean(previewEntry)}
        title="Restore this version?"
        description={previewEntry
          ? `This will replace your current draft with the version saved on ${
              formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'MMM d, yyyy')
            } at ${formatInTimeZone(new Date(previewEntry.created_at), 'America/Toronto', 'h:mm a')}.`
          : undefined}
        confirmLabel={restoringId ? 'Restoring...' : 'Restore'}
        isCancelDisabled={restoringId !== null}
        isConfirmDisabled={restoringId !== null}
        onCancel={() => setShowRestoreModal(false)}
        onConfirm={confirmRestore}
      />

      {/* Comments panel */}
      {feedbackVisible && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-default">Comments</h3>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-2 text-sm md:pr-4 md:border-r md:border-border">
              {doc?.returned_at && hasCompletionScore && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Completion</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {doc.score_completion}
                    </span>
                    <span className="text-xs text-text-muted">10</span>
                  </span>
                </div>
              )}
              {doc?.returned_at && hasThinkingScore && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Thinking</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {doc.score_thinking}
                    </span>
                    <span className="text-xs text-text-muted">10</span>
                  </span>
                </div>
              )}
              {doc?.returned_at && hasWorkflowScore && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">Workflow</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {doc.score_workflow}
                    </span>
                    <span className="text-xs text-text-muted">10</span>
                  </span>
                </div>
              )}
              {doc?.returned_at && hasFullScoreSet && (
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 pt-1">
                  <span className="text-text-default font-medium">Total</span>
                  <div className="flex justify-center">
                    <span className="inline-flex items-center border border-border rounded-md px-3 py-1 text-xl font-semibold text-text-default">
                      {Math.round((((doc.score_completion ?? 0) + (doc.score_thinking ?? 0) + (doc.score_workflow ?? 0)) / 30) * 100)}%
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <span className="inline-flex items-center border border-border rounded-md px-2 py-1 text-base text-text-default">
                      {(doc.score_completion ?? 0) + (doc.score_thinking ?? 0) + (doc.score_workflow ?? 0)}
                    </span>
                    <span className="text-xs text-text-muted">30</span>
                  </span>
                </div>
              )}
              {doc?.returned_at ? (
                !hasAnyScore && (
                  <div className="text-xs text-text-muted">No score assigned.</div>
                )
              ) : (
                <div className="text-xs text-text-muted">Grades will appear after your teacher returns them.</div>
              )}
            </div>
            <div className="space-y-3">
              {displayedFeedbackEntries.length > 0 ? (
                displayedFeedbackEntries.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border bg-page px-3 py-2">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                      {entry.entry_kind === 'grading_feedback' ? 'Grade Return' : 'Returned Comments'} . {' '}
                      {formatInTimeZone(new Date(entry.returned_at), 'America/Toronto', 'MMM d, h:mm a')}
                    </div>
                    <div className="text-sm text-text-default whitespace-pre-wrap">
                      {entry.body}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-text-default whitespace-pre-wrap">
                  {doc?.feedback?.trim() || 'No comments provided yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submission info */}
      {isSubmitted && doc?.submitted_at && (
        <div className="text-sm text-text-muted text-center">
          Submitted on{' '}
          {new Date(doc.submitted_at).toLocaleString('en-CA', {
            timeZone: 'America/Toronto',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </div>
      )}
    </div>
  )

  if (isEmbedded) {
    return editorContent
  }

  return (
    <PageLayout className="h-full flex flex-col">
      <PageActionBar
        primary={
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                className={ACTIONBAR_BUTTON_CLASSNAME}
                onClick={() => router.push(`/classrooms/${classroomId}`)}
              >
                Back to classroom
              </button>
              <div className="mt-2 text-sm font-medium text-text-default truncate">
                {assignment.title}
              </div>
              <div className="text-xs text-text-muted truncate">
                Due: {formatDueDate(assignment.due_at)} • {formatAssignmentTiming(assignment.due_at, doc)}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={getAssignmentStatusBadgeClass(status)}>
                {getAssignmentStatusLabel(status)}
              </span>
              {canUnsubmit ? (
                <Button size="sm" onClick={handleUnsubmit} variant="secondary" disabled={submitting || !!previewEntry}>
                  {submitting ? 'Unsubmitting...' : 'Unsubmit'}
                </Button>
              ) : !isSubmitted ? (
                <Button size="sm" onClick={handleSubmit} disabled={submitting || !canSubmit}>
                  {submitting ? 'Submitting...' : 'Submit'}
                </Button>
              ) : null}
            </div>
          </div>
        }
      />

      <PageContent className="flex-1 min-h-0">{editorContent}</PageContent>
    </PageLayout>
  )
})
