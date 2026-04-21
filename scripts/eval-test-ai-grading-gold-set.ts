import {
  suggestTestOpenResponseGrade,
  type TestOpenResponsePromptProfile,
} from '@/lib/ai-test-grading'
import {
  TEST_AI_GRADING_GOLD_SET,
  TEST_AI_GOLD_SET_REVIEW_STATUS,
} from './fixtures/test-ai-grading-gold-set'

type FixtureResult = {
  id: string
  label: string
  questionType: string
  acceptedRange: string
  manualScore: number
  bulkScore: number
  manualInRange: boolean
  bulkInRange: boolean
  parityOk: boolean
}

async function gradeFixture(id: string, promptProfile: TestOpenResponsePromptProfile) {
  const fixture = TEST_AI_GRADING_GOLD_SET.find((entry) => entry.id === id)
  if (!fixture) {
    throw new Error(`Missing gold-set fixture: ${id}`)
  }

  const suggestion = await suggestTestOpenResponseGrade({
    testTitle: fixture.testTitle,
    questionText: fixture.questionText,
    responseText: fixture.responseText,
    maxPoints: fixture.maxPoints,
    answerKey: fixture.answerKey,
    sampleSolution: fixture.sampleSolution,
    responseMonospace: fixture.responseMonospace,
    promptProfile,
  })

  return suggestion.score
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY must be set to run the gold-set evaluation.')
  }

  console.log(`Gold-set review status: ${TEST_AI_GOLD_SET_REVIEW_STATUS}`)
  console.log(`Running ${TEST_AI_GRADING_GOLD_SET.length} fixtures across manual and bulk prompt profiles...`)

  const results: FixtureResult[] = []

  for (const fixture of TEST_AI_GRADING_GOLD_SET) {
    const manualScore = await gradeFixture(fixture.id, 'manual')
    const bulkScore = await gradeFixture(fixture.id, 'bulk')
    const manualInRange =
      manualScore >= fixture.acceptedScoreRange.min &&
      manualScore <= fixture.acceptedScoreRange.max
    const bulkInRange =
      bulkScore >= fixture.acceptedScoreRange.min &&
      bulkScore <= fixture.acceptedScoreRange.max
    const parityOk = Math.abs(manualScore - bulkScore) <= 1

    results.push({
      id: fixture.id,
      label: fixture.label,
      questionType: fixture.questionType,
      acceptedRange: `${fixture.acceptedScoreRange.min}-${fixture.acceptedScoreRange.max}`,
      manualScore,
      bulkScore,
      manualInRange,
      bulkInRange,
      parityOk,
    })
  }

  console.table(results)

  const summary = {
    total: results.length,
    manualInRange: results.filter((row) => row.manualInRange).length,
    bulkInRange: results.filter((row) => row.bulkInRange).length,
    parityOk: results.filter((row) => row.parityOk).length,
    codingBulkInRange: results.filter(
      (row) => row.questionType === 'coding' && row.bulkInRange
    ).length,
    codingTotal: results.filter((row) => row.questionType === 'coding').length,
  }

  console.log('Summary')
  console.table([summary])

  const failed = results.filter((row) => !row.manualInRange || !row.bulkInRange || !row.parityOk)
  if (failed.length > 0) {
    console.log('Fixtures requiring review')
    console.table(failed)
    process.exitCode = 1
  }
}

void main()
