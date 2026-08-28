import { ApiError } from '@/lib/api-handler'

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS_PER_WINDOW = 3
const STALE_ACTIVE_SLOT_MS = 60 * 1000

type ExtractionSlot = {
  attempts: number[]
  activeSinceMs?: number
  activeReservation?: symbol
}

const extractionSlots = new Map<string, ExtractionSlot>()

function slotKey(teacherId: string, classroomId: string): string {
  return `${teacherId}\u0000${classroomId}`
}

export function acquireCourseGuideImportExtractionSlot(
  args: { teacherId: string; classroomId: string },
  nowMs = Date.now(),
): () => void {
  const key = slotKey(args.teacherId, args.classroomId)
  const slot = extractionSlots.get(key) || { attempts: [] }
  slot.attempts = slot.attempts.filter((attemptMs) => attemptMs > nowMs - ATTEMPT_WINDOW_MS)

  if (
    slot.activeReservation
    && slot.activeSinceMs !== undefined
    && slot.activeSinceMs > nowMs - STALE_ACTIVE_SLOT_MS
  ) {
    throw new ApiError(429, 'A curriculum import is already running for this Course Guide.')
  }
  if (slot.attempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
    throw new ApiError(429, 'Too many curriculum import attempts. Try again in a few minutes.')
  }

  const reservation = Symbol('course-guide-import-extraction')
  slot.activeReservation = reservation
  slot.activeSinceMs = nowMs
  slot.attempts.push(nowMs)
  extractionSlots.set(key, slot)

  return () => {
    const current = extractionSlots.get(key)
    if (!current || current.activeReservation !== reservation) return
    delete current.activeReservation
    delete current.activeSinceMs
  }
}
