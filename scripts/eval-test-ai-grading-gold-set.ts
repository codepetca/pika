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
  calibrated: boolean
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
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new Error('DEEPSEEK_API_KEY must be set to run the gold-set evaluation.')
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
      calibrated: fixture.provenance === 'calibrated',
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

  const outOfRange = (row: FixtureResult) =>
    !row.manualInRange || !row.bulkInRange || !row.parityOk

  // Only calibrated ranges gate the run. The rest were written alongside their fixtures
  // and never checked against a teacher, so failing one says nothing about the grader —
  // and letting them fail the command would leave it permanently red and ignored.
  const calibratedFailures = results.filter((row) => row.calibrated && outOfRange(row))
  const unreviewedFailures = results.filter((row) => !row.calibrated && outOfRange(row))

  if (unreviewedFailures.length > 0) {
    console.log(
      `${unreviewedFailures.length} unreviewed fixture(s) outside their range (informational — these ranges are not teacher-checked)`,
    )
    console.table(unreviewedFailures)
  }

  if (calibratedFailures.length > 0) {
    console.log('CALIBRATED fixtures outside their range — the grader has regressed')
    console.table(calibratedFailures)
    process.exitCode = 1
    return
  }

  const calibratedTotal = results.filter((row) => row.calibrated).length
  console.log(`All ${calibratedTotal} calibrated fixtures are within their teacher-set ranges.`)
}

void main()
