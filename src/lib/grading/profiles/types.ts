import type { GradingRubric } from '@/lib/grading/contracts'

export interface NormalizedProfileOutput {
  criteria: Array<{
    criterionId: string
    score: number
    rationale?: string | null
    evidence?: string[]
    confidence?: number | null
    flags?: string[]
  }>
  feedback: {
    student: string
    teacherNotes: string | null
  }
}

export interface GradingProfile<TInput, TOutput> {
  readonly id: string
  readonly version: string
  readonly promptVersion: string
  readonly rubric: GradingRubric
  readonly output: {
    schemaName: string
    jsonSchema: Record<string, unknown>
    initialMaxOutputTokens: number
    fallbackMaxOutputTokens: number
  }
  buildPrompt(input: TInput): {
    systemPrompt: string
    userPrompt: string
  }
  parseOutput(outputText: string): TOutput
  normalizeOutput(output: TOutput): NormalizedProfileOutput
}
