import {
  buildTestOpenResponseBatchSystemPrompt,
  buildTestOpenResponseBatchUserPrompt,
  buildTestOpenResponsePreparedContext,
  buildTestOpenResponseSingleUserPrompt,
} from '@/lib/ai-test-grading'
import { buildAssignmentGradingRequest } from '@/lib/ai-grading'
import { estimatePromptMetrics } from '@/lib/ai-prompt-metrics'
import { TEST_AI_GRADING_GOLD_SET } from './fixtures/test-ai-grading-gold-set'

type MeasurementRow = {
  scenario: string
  prompt_profile: string
  responses: number
  prompt_chars: number
  estimated_input_tokens: number
}

function findFixture(id: string) {
  const fixture = TEST_AI_GRADING_GOLD_SET.find((entry) => entry.id === id)
  if (!fixture) {
    throw new Error(`Missing gold-set fixture: ${id}`)
  }
  return fixture
}

function measureSinglePrompt(
  label: string,
  fixtureId: string,
  promptProfile: 'manual' | 'bulk'
): MeasurementRow {
  const fixture = findFixture(fixtureId)
  const prepared = buildTestOpenResponsePreparedContext({
    testTitle: fixture.testTitle,
    questionText: fixture.questionText,
    maxPoints: fixture.maxPoints,
    answerKey: fixture.answerKey,
    sampleSolution: fixture.sampleSolution,
    responseMonospace: fixture.responseMonospace,
    promptProfile,
  })
  const userPrompt = buildTestOpenResponseSingleUserPrompt(prepared, fixture.responseText)
  const metrics = estimatePromptMetrics(prepared.systemPrompt, userPrompt)

  return {
    scenario: label,
    prompt_profile: promptProfile,
    responses: 1,
    prompt_chars: metrics.totalChars,
    estimated_input_tokens: metrics.estimatedInputTokens,
  }
}

function measureBatchPrompt(
  label: string,
  fixtureIds: string[],
  promptProfile: 'manual' | 'bulk'
): MeasurementRow {
  const fixtures = fixtureIds.map(findFixture)
  const [firstFixture] = fixtures
  const prepared = buildTestOpenResponsePreparedContext({
    testTitle: firstFixture.testTitle,
    questionText: firstFixture.questionText,
    maxPoints: firstFixture.maxPoints,
    answerKey: firstFixture.answerKey,
    sampleSolution: firstFixture.sampleSolution,
    responseMonospace: firstFixture.responseMonospace,
    promptProfile,
  })
  const systemPrompt = buildTestOpenResponseBatchSystemPrompt(prepared)
  const userPrompt = buildTestOpenResponseBatchUserPrompt(
    prepared,
    fixtures.map((fixture) => ({
      responseId: fixture.id,
      responseText: fixture.responseText,
    }))
  )
  const metrics = estimatePromptMetrics(systemPrompt, userPrompt)

  return {
    scenario: label,
    prompt_profile: promptProfile,
    responses: fixtures.length,
    prompt_chars: metrics.totalChars,
    estimated_input_tokens: metrics.estimatedInputTokens,
  }
}

function measureAssignmentPrompt(): MeasurementRow {
  const request = buildAssignmentGradingRequest({
    assignmentTitle: 'Portfolio Reflection',
    instructions: 'Write a short reflection and include the link to your finished portfolio site.',
    studentWork: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'I improved my navigation and layout this week. My portfolio is linked here.',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://student.example.com/portfolio' },
                },
              ],
            },
          ],
        },
      ],
    },
  })
  const metrics = estimatePromptMetrics(request.systemPrompt, request.userPrompt)

  return {
    scenario: 'assignment auto-grade',
    prompt_profile: 'default',
    responses: 1,
    prompt_chars: metrics.totalChars,
    estimated_input_tokens: metrics.estimatedInputTokens,
  }
}

function percentReduction(from: number, to: number): string {
  if (from <= 0) return '0.0%'
  return `${(((from - to) / from) * 100).toFixed(1)}%`
}

async function main() {
  const rows: MeasurementRow[] = [
    measureAssignmentPrompt(),
    measureSinglePrompt('non-coding test grading', 'noncoding-osmosis-full', 'manual'),
    measureSinglePrompt('non-coding test grading', 'noncoding-osmosis-full', 'bulk'),
    measureSinglePrompt('coding test grading', 'coding-vowels-full', 'manual'),
    measureSinglePrompt('coding test grading', 'coding-vowels-full', 'bulk'),
    measureBatchPrompt(
      'coding batch grading (3 responses)',
      ['coding-vowels-full', 'coding-vowels-syntax-partial', 'coding-vowels-partial'],
      'manual'
    ),
    measureBatchPrompt(
      'coding batch grading (3 responses)',
      ['coding-vowels-full', 'coding-vowels-syntax-partial', 'coding-vowels-partial'],
      'bulk'
    ),
  ]

  console.log('AI grading prompt size measurements')
  console.table(rows)

  const compare = (scenario: string) => {
    const manual = rows.find((row) => row.scenario === scenario && row.prompt_profile === 'manual')
    const bulk = rows.find((row) => row.scenario === scenario && row.prompt_profile === 'bulk')
    if (!manual || !bulk) return

    console.log(
      `${scenario}: ${manual.estimated_input_tokens} -> ${bulk.estimated_input_tokens} estimated input tokens (${percentReduction(
        manual.estimated_input_tokens,
        bulk.estimated_input_tokens
      )} reduction)`
    )
  }

  compare('non-coding test grading')
  compare('coding test grading')
  compare('coding batch grading (3 responses)')
}

void main()
