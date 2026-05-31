import { describe, expect, it, vi } from 'vitest'
import {
  loadAssignmentSubmissionArtifactsForDocs,
  replaceAssignmentSubmissionRequirements,
} from '@/lib/server/assignment-submission-artifacts'
import type { AssignmentSubmissionArtifact, AssignmentSubmissionRequirement } from '@/types'

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], rangeCalls: [] }
}

function mockPagedTable(
  rows: Array<Record<string, any>>,
  options: {
    table?: string
    log?: QueryLog
    error?: any
  } = {},
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const filteredRows = () => rows.filter((row) =>
        filters.every((filter) => {
          if (!(filter.column in row)) return false
          return filter.values.includes(String(row[filter.column]))
        })
      )
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values: values.map(String) })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values: values.map(String) })
          }
          return query
        }),
        order: vi.fn(() => query),
        range: vi.fn((from: number, to: number) => {
          if (options.table) {
            options.log?.rangeCalls.push({ table: options.table, from, to })
          }
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error })
          }
          return Promise.resolve({
            data: filteredRows().slice(from, to + 1),
            error: null,
          })
        }),
      }
      return query
    }),
  }
}

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

function makeArtifact(
  overrides: Partial<AssignmentSubmissionArtifact>
): AssignmentSubmissionArtifact {
  return {
    id: overrides.id ?? 'artifact-1',
    assignment_doc_id: overrides.assignment_doc_id ?? 'doc-1',
    requirement_id: overrides.requirement_id ?? 'req-1',
    student_id: overrides.student_id ?? 'student-1',
    type: overrides.type ?? 'link',
    url: overrides.url ?? 'https://example.com/work',
    storage_path: overrides.storage_path ?? null,
    metadata_json: overrides.metadata_json ?? {},
    validation_status: overrides.validation_status ?? 'valid',
    validation_message: overrides.validation_message ?? null,
    validated_at: overrides.validated_at ?? '2026-05-01T00:00:00.000Z',
    created_at: overrides.created_at ?? '2026-05-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-01T00:00:00.000Z',
  }
}

describe('replaceAssignmentSubmissionRequirements', () => {
  it('delegates replacement to the atomic database function with normalized drafts', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        makeRequirement({ id: 'new-1', type: 'link', label: 'Public demo', position: 0 }),
        makeRequirement({ id: 'req-repo', type: 'repo_link', label: 'Repository URL', position: 1 }),
      ],
      error: null,
    }))
    const supabase = { rpc }

    const result = await replaceAssignmentSubmissionRequirements(supabase, 'assignment-1', [
      { type: 'link', label: '  Public demo  ', position: 0 },
      { id: 'req-repo', type: 'repo_link', label: 'Repository URL', position: 1 },
    ])

    expect(rpc).toHaveBeenCalledWith('replace_assignment_submission_requirements_atomic', {
      p_assignment_id: 'assignment-1',
      p_requirements: [
        {
          id: undefined,
          type: 'link',
          label: 'Public demo',
          instructions: '',
          required: true,
          position: 0,
          validation_policy_json: {},
        },
        {
          id: 'req-repo',
          type: 'repo_link',
          label: 'Repository URL',
          instructions: '',
          required: true,
          position: 1,
          validation_policy_json: {},
        },
      ],
    })
    expect(result.map((requirement) => requirement.id)).toEqual(['new-1', 'req-repo'])
  })
})

describe('loadAssignmentSubmissionArtifactsForDocs', () => {
  it('chunks doc filters and pages large artifact result sets', async () => {
    const docIds = Array.from({ length: 51 }, (_, index) => `doc-${index}`)
    const rows = [
      ...Array.from({ length: 1001 }, (_, index) =>
        makeArtifact({
          id: `artifact-doc-0-${index}`,
          assignment_doc_id: 'doc-0',
          student_id: 'student-0',
          url: `https://example.com/work-${index}`,
        })
      ),
      makeArtifact({
        id: 'artifact-doc-50',
        assignment_doc_id: 'doc-50',
        student_id: 'student-50',
        url: 'https://example.com/work-50',
      }),
    ]
    const log = createQueryLog()
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'assignment_submission_artifacts') {
          return mockPagedTable(rows, { table, log })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: { from: vi.fn() },
    }

    const result = await loadAssignmentSubmissionArtifactsForDocs(supabase, docIds)

    expect(result).toHaveLength(1002)
    expect(result.map((artifact) => artifact.id)).toContain('artifact-doc-50')
    expect(log.inCalls.map((call) => call.values.length)).toEqual([50, 50, 1])
    expect(log.rangeCalls).toEqual([
      { table: 'assignment_submission_artifacts', from: 0, to: 999 },
      { table: 'assignment_submission_artifacts', from: 1000, to: 1999 },
      { table: 'assignment_submission_artifacts', from: 0, to: 999 },
    ])
  })
})
