import { describe, expect, it } from 'vitest'
import {
  PLANNED_COURSE_FIXTURE,
  seedPlannedCourseFixtures,
} from '../../scripts/seed-planned-course-fixtures'

type SeedRow = Record<string, unknown> & { id: string }

class FixtureSupabase {
  readonly rows = new Map<string, SeedRow[]>()

  from(table: string) {
    const getRows = () => this.rows.get(table) ?? []
    const setRows = (rows: SeedRow[]) => this.rows.set(table, rows)

    return {
      upsert: async (row: SeedRow) => {
        const existing = getRows()
        const index = existing.findIndex((candidate) => candidate.id === row.id)
        if (index === -1) {
          setRows([...existing, structuredClone(row)])
        } else {
          const next = [...existing]
          next[index] = { ...next[index], ...structuredClone(row) }
          setRows(next)
        }
        return { error: null }
      },
      insert: async (row: SeedRow) => {
        if (getRows().some((candidate) => candidate.id === row.id)) {
          return { error: new Error(`duplicate row ${row.id}`) }
        }
        setRows([...getRows(), structuredClone(row)])
        return { error: null }
      },
      delete: () => ({
        eq: async (column: string, value: unknown) => {
          setRows(getRows().filter((row) => row[column] !== value))
          return { error: null }
        },
      }),
    }
  }

  fixtureSnapshot() {
    const fixtureIds = new Set([
      PLANNED_COURSE_FIXTURE.blueprintId,
      PLANNED_COURSE_FIXTURE.privateBlueprintId,
    ])
    return Object.fromEntries(
      [...this.rows.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([table, rows]) => [
          table,
          rows.filter((row) => (
            fixtureIds.has(String(row.id))
            || fixtureIds.has(String(row.course_blueprint_id))
          )),
        ]),
    )
  }
}

describe('seedPlannedCourseFixtures', () => {
  it('converges reserved fixture rows to one stable identity and content set', async () => {
    const supabase = new FixtureSupabase()
    supabase.rows.set('course_blueprint_assignments', [{
      id: '90000000-0000-4000-8000-000000000299',
      artifact_id: '90000000-0000-4000-8000-000000000298',
      course_blueprint_id: PLANNED_COURSE_FIXTURE.blueprintId,
      title: 'Drift row',
    }])

    await seedPlannedCourseFixtures(supabase as never, 'teacher-1')
    const first = supabase.fixtureSnapshot()

    const assignments = first.course_blueprint_assignments
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      id: PLANNED_COURSE_FIXTURE.assignmentId,
      artifact_id: PLANNED_COURSE_FIXTURE.assignmentArtifactId,
    })
    expect(first.course_blueprint_assessments[0]).toMatchObject({
      id: PLANNED_COURSE_FIXTURE.assessmentId,
      artifact_id: PLANNED_COURSE_FIXTURE.assessmentArtifactId,
    })
    expect(first.course_blueprint_lesson_templates[0]).toMatchObject({
      id: PLANNED_COURSE_FIXTURE.lessonTemplateId,
      artifact_id: PLANNED_COURSE_FIXTURE.lessonTemplateArtifactId,
    })

    supabase.rows.get('course_blueprint_assessments')!.push({
      id: '90000000-0000-4000-8000-000000000297',
      artifact_id: '90000000-0000-4000-8000-000000000296',
      course_blueprint_id: PLANNED_COURSE_FIXTURE.blueprintId,
      title: 'Later drift row',
    })
    await seedPlannedCourseFixtures(supabase as never, 'teacher-1')

    expect(supabase.fixtureSnapshot()).toEqual(first)
  })
})
