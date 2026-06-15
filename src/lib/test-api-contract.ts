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

type TestApiListPayload<T> = {
  tests?: T[] | null
  quizzes?: T[] | null
}

type TestApiDetailPayload<T> = {
  test?: T | null
  quiz?: T | null
}

export function readTestsFromPayload<T>(payload: TestApiListPayload<T> | null | undefined): T[] {
  return payload?.tests ?? payload?.quizzes ?? []
}

export function readTestFromPayload<T>(payload: TestApiDetailPayload<T> | null | undefined): T | undefined {
  return payload?.test ?? payload?.quiz ?? undefined
}
