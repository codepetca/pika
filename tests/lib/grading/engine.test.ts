import { describe, expect, it, vi } from 'vitest'
import { executeGrading, executeStructuredOutput } from '@/lib/grading/engine'
import type { GradingProfile } from '@/lib/grading/profiles/types'
import type { StructuredOutputProvider } from '@/lib/grading/providers/types'

type ExampleInput = { submission: string }
type ExampleOutput = { completion: number; feedback: string }

const profile: GradingProfile<ExampleInput, ExampleOutput> = {
  id: 'example',
  version: 'example-v1',
  promptVersion: 'example-prompt-v1',
  rubric: {
    version: 'example-rubric-v1',
    criteria: [
      {
        id: 'completion',
        label: 'Completion',
        description: 'How complete the response is.',
        kind: 'content',
        scale: { min: 0, max: 10 },
        weight: 2,
      },
    ],
  },
  output: {
    schemaName: 'example_grade',
    jsonSchema: { type: 'object' },
    initialMaxOutputTokens: 100,
    fallbackMaxOutputTokens: 200,
  },
  buildPrompt: (input) => ({
    systemPrompt: 'Grade this response.',
    userPrompt: input.submission,
  }),
  parseOutput: (outputText) => JSON.parse(outputText) as ExampleOutput,
  normalizeOutput: (output) => ({
    criteria: [{ criterionId: 'completion', score: output.completion }],
    feedback: { student: output.feedback, teacherNotes: null },
  }),
}

function providerReturning(outputText: string): StructuredOutputProvider {
  return {
    id: 'fake',
    generate: vi.fn().mockResolvedValue({
      outputText,
      requestCount: 1,
      tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    }),
  }
}

describe('executeGrading', () => {
  it('returns canonical scores and reproducibility metadata', async () => {
    const provider = providerReturning('{"completion":8,"feedback":"Useful feedback."}')

    const result = await executeGrading({
      input: { submission: 'Student response' },
      profile,
      provider,
      policy: {
        version: 'policy-v1',
        model: 'model-v1',
        requestTimeoutMs: 25_000,
        reasoningEffort: 'minimal',
      },
    })

    expect(result).toMatchObject({
      overallScore: 16,
      maxScore: 20,
      percent: 80,
      provider: 'fake',
      model: 'model-v1',
      policyVersion: 'policy-v1',
      promptVersion: 'example-prompt-v1',
      gradingProfileVersion: 'example-v1',
      rubricVersion: 'example-rubric-v1',
      providerRequestCount: 1,
      tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    })
    expect(result.criteriaResults).toEqual([
      expect.objectContaining({
        criterionId: 'completion',
        score: 8,
        maxScore: 10,
        weightedScore: 16,
        weightedMaxScore: 20,
      }),
    ])
  })

  it('rejects provider criteria that are not declared by the rubric', async () => {
    const invalidProfile: GradingProfile<ExampleInput, ExampleOutput> = {
      ...profile,
      normalizeOutput: () => ({
        criteria: [{ criterionId: 'invented', score: 8 }],
        feedback: { student: 'Feedback', teacherNotes: null },
      }),
    }

    await expect(executeGrading({
      input: { submission: 'Student response' },
      profile: invalidProfile,
      provider: providerReturning('{"completion":8,"feedback":"Feedback"}'),
      policy: {
        version: 'policy-v1',
        model: 'model-v1',
        requestTimeoutMs: 25_000,
        reasoningEffort: 'minimal',
      },
    })).rejects.toThrow('Unknown grading criterion: invented')
  })
})

describe('executeStructuredOutput', () => {
  it('returns parsed output with provider execution metadata', async () => {
    const provider = providerReturning('{"completion":8,"feedback":"Useful feedback."}')

    const result = await executeStructuredOutput({
      provider,
      policy: {
        version: 'policy-v1',
        model: 'model-v1',
        requestTimeoutMs: 25_000,
        reasoningEffort: 'minimal',
      },
      prompt: {
        systemPrompt: 'Grade this response.',
        userPrompt: 'Student response',
      },
      output: profile.output,
      parseOutput: profile.parseOutput,
    })

    expect(result).toEqual({
      output: { completion: 8, feedback: 'Useful feedback.' },
      execution: {
        provider: 'fake',
        model: 'model-v1',
        policyVersion: 'policy-v1',
        providerRequestCount: 1,
        tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      },
    })
  })

  it('normalizes parser failures into grading output errors', async () => {
    await expect(executeStructuredOutput({
      provider: providerReturning('not-json'),
      policy: {
        version: 'policy-v1',
        model: 'model-v1',
        reasoningEffort: 'minimal',
      },
      prompt: {
        systemPrompt: 'Grade this response.',
        userPrompt: 'Student response',
      },
      output: profile.output,
      parseOutput: profile.parseOutput,
    })).rejects.toMatchObject({ name: 'GradingOutputError' })
  })
})
