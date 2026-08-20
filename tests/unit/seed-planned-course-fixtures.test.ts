import { describe, expect, it } from 'vitest'
import {
  PLANNED_COURSE_FIXTURE,
  seedPlannedCourseFixtures,
} from '../../scripts/seed-planned-course-fixtures'

type SeedRow = Record<string, unknown> & { id: string }

class FixtureSupabase {
  readonly rows = new Map<string, SeedRow[]>()
  failUpsertTable: string | null = null

  from(table: string) {
    const getRows = () => this.rows.get(table) ?? []
    const setRows = (rows: SeedRow[]) => this.rows.set(table, rows)

    return {
      select: () => ({
        in: async (column: string, values: unknown[]) => ({
          data: structuredClone(getRows().filter((row) => values.includes(row[column]))),
          error: null,
        }),
      }),
      upsert: async (row: SeedRow) => {
        if (this.failUpsertTable === table) {
          return { error: new Error(`injected ${table} failure`) }
        }
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
      update: (values: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          setRows(getRows().map((row) => (
            row[column] === value ? { ...row, ...structuredClone(values) } : row
          )))
          return { error: null }
        },
      }),
      delete: () => {
        const filters: Array<(row: SeedRow) => boolean> = []
        const builder = {
          eq(column: string, value: unknown) {
            filters.push((row) => row[column] === value)
            return builder
          },
          neq(column: string, value: unknown) {
            filters.push((row) => row[column] !== value)
            return builder
          },
          then(
            resolve: (result: { error: null }) => unknown,
            reject: (error: unknown) => unknown,
          ) {
            return Promise.resolve().then(() => {
              setRows(getRows().filter((row) => !filters.every((filter) => filter(row))))
              return { error: null as null }
            }).then(resolve, reject)
          },
        }
        return builder
      },
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

    expect(await seedPlannedCourseFixtures(supabase as never, 'teacher-1')).toEqual({ changed: true })
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
    expect(await seedPlannedCourseFixtures(supabase as never, 'teacher-1')).toEqual({ changed: true })

    expect(supabase.fixtureSnapshot()).toEqual(first)

    expect(await seedPlannedCourseFixtures(supabase as never, 'teacher-1')).toEqual({ changed: false })
    expect(supabase.fixtureSnapshot()).toEqual(first)
  })

  it('leaves a drifted public fixture unpublished when child reconciliation fails', async () => {
    const supabase = new FixtureSupabase()
    await seedPlannedCourseFixtures(supabase as never, 'teacher-1')
    supabase.rows.get('course_blueprint_assignments')!.push({
      id: '90000000-0000-4000-8000-000000000295',
      course_blueprint_id: PLANNED_COURSE_FIXTURE.blueprintId,
      title: 'Drift row',
    })
    supabase.failUpsertTable = 'course_blueprint_assignments'

    await expect(seedPlannedCourseFixtures(supabase as never, 'teacher-1'))
      .rejects.toThrow('injected course_blueprint_assignments failure')

    const publicBlueprint = supabase.rows.get('course_blueprints')!
      .find((row) => row.id === PLANNED_COURSE_FIXTURE.blueprintId)
    expect(publicBlueprint?.planned_site_published).toBe(false)
  })
})
