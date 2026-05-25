import { describe, expect, it } from 'vitest'
import { replaceAssignmentSubmissionRequirements } from '@/lib/server/assignment-submission-artifacts'
import type { AssignmentSubmissionRequirement } from '@/types'

function makeRequirement(
  overrides: Partial<AssignmentSubmissionRequirement>
): AssignmentSubmissionRequirement {
  return {
    id: overrides.id ?? 'req-1',
    assignment_id: overrides.assignment_id ?? 'assignment-1',
    type: overrides.type ?? 'link',
    label: overrides.label ?? 'Public link',
    instructions: overrides.instructions ?? '',
    required: overrides.required ?? true,
    position: overrides.position ?? 0,
    validation_policy_json: overrides.validation_policy_json ?? {},
    created_at: overrides.created_at ?? '2026-05-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-01T00:00:00.000Z',
  }
}

class FakeRequirementsQuery {
  private operation: 'select' | 'delete' | 'insert' | 'upsert' = 'select'
  private rows: any[] = []
  private filters = new Map<string, unknown>()
  private inFilters = new Map<string, unknown[]>()

  constructor(private readonly state: { requirements: AssignmentSubmissionRequirement[]; nextId: number }) {}

  select() {
    this.operation = 'select'
    return this
  }

  delete() {
    this.operation = 'delete'
    return this
  }

  insert(rows: any[]) {
    this.operation = 'insert'
    this.rows = rows
    return this
  }

  upsert(rows: any[]) {
    this.operation = 'upsert'
    this.rows = rows
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.inFilters.set(column, values)
    return this
  }

  order() {
    return this
  }

  private matchesFilters(requirement: AssignmentSubmissionRequirement): boolean {
    for (const [column, value] of this.filters) {
      if ((requirement as any)[column] !== value) return false
    }
    for (const [column, values] of this.inFilters) {
      if (!values.includes((requirement as any)[column])) return false
    }
    return true
  }

  private async execute() {
    if (this.operation === 'delete') {
      this.state.requirements = this.state.requirements.filter((requirement) => !this.matchesFilters(requirement))
      return { data: null, error: null }
    }

    if (this.operation === 'upsert') {
      for (const row of this.rows) {
        const existingIndex = this.state.requirements.findIndex((requirement) => requirement.id === row.id)
        if (existingIndex >= 0) {
          this.state.requirements[existingIndex] = {
            ...this.state.requirements[existingIndex],
            ...row,
          }
        }
      }
      return { data: null, error: null }
    }

    if (this.operation === 'insert') {
      for (const row of this.rows) {
        this.state.requirements.push(makeRequirement({
          ...row,
          id: `new-${this.state.nextId++}`,
        }))
      }
      return { data: null, error: null }
    }

    return {
      data: this.state.requirements
        .filter((requirement) => this.matchesFilters(requirement))
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
      error: null,
    }
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: AssignmentSubmissionRequirement[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  readonly state: { requirements: AssignmentSubmissionRequirement[]; nextId: number }

  constructor(requirements: AssignmentSubmissionRequirement[]) {
    this.state = { requirements, nextId: 1 }
  }

  from(table: string) {
    if (table !== 'assignment_submission_requirements') {
      throw new Error(`Unexpected table: ${table}`)
    }
    return new FakeRequirementsQuery(this.state)
  }
}

describe('replaceAssignmentSubmissionRequirements', () => {
  it('preserves matching requirement ids so existing student artifacts stay attached', async () => {
    const supabase = new FakeSupabase([
      makeRequirement({ id: 'req-repo', type: 'repo_link', label: 'Repo link', position: 0 }),
      makeRequirement({ id: 'req-image', type: 'image', label: 'Screenshot', position: 1 }),
    ])

    const result = await replaceAssignmentSubmissionRequirements(supabase, 'assignment-1', [
      { type: 'link', label: 'Public demo', position: 0 },
      { id: 'req-repo', type: 'repo_link', label: 'Repository URL', position: 1 },
    ])

    expect(result.map((requirement) => requirement.id)).toEqual(['new-1', 'req-repo'])
    expect(result.map((requirement) => requirement.label)).toEqual(['Public demo', 'Repository URL'])
    expect(supabase.state.requirements.some((requirement) => requirement.id === 'req-image')).toBe(false)
  })
})
