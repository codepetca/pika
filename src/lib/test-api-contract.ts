/**
 * Tests are the active product surface, but these routes still emit legacy
 * quiz-shaped keys for older clients during the contract transition.
 */
export function withLegacyQuizListKey<T>(tests: T[]): { tests: T[]; quizzes: T[] } {
  return {
    tests,
    quizzes: tests,
  }
}

export function withLegacyQuizKey<T>(test: T): { test: T; quiz: T } {
  return {
    test,
    quiz: test,
  }
}
