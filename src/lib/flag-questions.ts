/**
 * Utilities for managing flagged questions during test/quiz taking.
 * Flagged questions are stored client-side in localStorage, keyed by test ID.
 */

/**
 * Get the localStorage key for a test's flagged questions
 */
function getFlaggedQuestionsKey(testId: string): string {
  return `pika:flagged-questions:${testId}`
}

/**
 * Get the array of flagged question IDs for a test
 */
export function getFlaggedQuestions(testId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(getFlaggedQuestionsKey(testId))
    return stored ? JSON.parse(stored) : []
  } catch (error) {
    console.error('Error reading flagged questions from localStorage:', error)
    return []
  }
}

/**
 * Check if a specific question is flagged
 */
export function isQuestionFlagged(testId: string, questionId: string): boolean {
  return getFlaggedQuestions(testId).includes(questionId)
}

/**
 * Toggle the flagged state of a question
 */
export function toggleFlaggedQuestion(testId: string, questionId: string): boolean {
  const flagged = getFlaggedQuestions(testId)
  const index = flagged.indexOf(questionId)

  let updated: string[]
  if (index >= 0) {
    // Question is flagged, remove it
    updated = flagged.filter((id) => id !== questionId)
  } else {
    // Question is not flagged, add it
    updated = [...flagged, questionId]
  }

  try {
    if (updated.length === 0) {
      localStorage.removeItem(getFlaggedQuestionsKey(testId))
    } else {
      localStorage.setItem(getFlaggedQuestionsKey(testId), JSON.stringify(updated))
    }
    return !flagged.includes(questionId) // Return new flagged state
  } catch (error) {
    console.error('Error updating flagged questions in localStorage:', error)
    return flagged.includes(questionId)
  }
}

/**
 * Clear all flagged questions for a test
 */
export function clearFlaggedQuestions(testId: string): void {
  try {
    localStorage.removeItem(getFlaggedQuestionsKey(testId))
  } catch (error) {
    console.error('Error clearing flagged questions from localStorage:', error)
  }
}

/**
 * Get the next flagged question ID after the current one
 * Returns undefined if no flagged questions or no next question found
 */
export function getNextFlaggedQuestion(
  testId: string,
  currentQuestionId: string | null
): string | undefined {
  const flagged = getFlaggedQuestions(testId)
  if (flagged.length === 0) return undefined

  if (!currentQuestionId) {
    // No current question, return first flagged
    return flagged[0]
  }

  // Find current question in flagged list
  const currentIndex = flagged.indexOf(currentQuestionId)
  if (currentIndex === -1) {
    // Current question is not flagged, return first flagged
    return flagged[0]
  }

  // Return next flagged, or wrap around to first
  return flagged[(currentIndex + 1) % flagged.length]
}
