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

  const calibratedTotal = TEST_AI_GRADING_GOLD_SET.filter(
    (fixture) => fixture.provenance === 'calibrated',
  ).length
  if (calibratedTotal === 0) {
    // Without this the gate passes vacuously: no calibrated fixtures means no range is
    // checked, and a total grader regression would still exit 0.
    throw new Error(
      'No fixtures are marked provenance: "calibrated". This gate checks nothing; restore the calibrated set before relying on it.',
    )
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

  const rangeMissed = (row: FixtureResult) => !row.manualInRange || !row.bulkInRange

  // Parity gates EVERY fixture. It asks whether the two prompt profiles agree with each
  // other, which needs no teacher verdict to be meaningful: a student's grade must not
  // depend on which screen the teacher used.
  const parityFailures = results.filter((row) => !row.parityOk)

  // Ranges gate only calibrated fixtures. The rest were written alongside their fixtures
  // and never checked against a teacher, so one failing says nothing about the grader —
  // and gating on them would leave this command permanently red and ignored.
  const calibratedRangeFailures = results.filter((row) => row.calibrated && rangeMissed(row))
  const unreviewedRangeFailures = results.filter((row) => !row.calibrated && rangeMissed(row))

  if (unreviewedRangeFailures.length > 0) {
    console.log(
      `${unreviewedRangeFailures.length} unreviewed fixture(s) outside their range (informational — these ranges are not teacher-checked)`,
    )
    console.table(unreviewedRangeFailures)
  }

  if (parityFailures.length > 0) {
    console.log('Manual and bulk disagree by more than a point — the same work grades differently by screen')
    console.table(parityFailures)
  }

  if (calibratedRangeFailures.length > 0) {
    console.log('CALIBRATED fixtures outside their range — the grader has regressed')
    console.table(calibratedRangeFailures)
  }

  if (parityFailures.length > 0 || calibratedRangeFailures.length > 0) {
    process.exitCode = 1
    return
  }

  console.log(
    `All ${calibratedTotal} calibrated fixtures are within their teacher-set ranges, and manual/bulk agree throughout.`,
  )
}

void main()
