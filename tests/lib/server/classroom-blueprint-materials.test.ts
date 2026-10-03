import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getClassroomBlueprintMaterials } from '@/lib/server/classroom-blueprint-materials'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from }) }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: vi.fn() }))

const versionId = 'b2d18c61-0714-4e46-b93a-1920fdaaf490'
const materialId = '8ad9cfa1-1c8e-4733-a16f-90cbc0a35111'
const material = { artifact_id: materialId, title: 'Java Explained', content_markdown: '[Lesson](https://example.com/java)', position: 15 }

function query(data: unknown, error: unknown = null) {
  const result = { data, error }
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(() => chain),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
  }
  return chain
}

function setup(snapshot: unknown = { materials: [material] }) {
  const classroom = query({ source_blueprint_id: 'blueprint' })
  const blueprint = query({ id: 'blueprint' })
  const version = query({ id: versionId, version_number: 5, snapshot_json: snapshot })
  from.mockReturnValueOnce(classroom).mockReturnValueOnce(blueprint).mockReturnValueOnce(version)
  return { classroom, blueprint, version }
}

describe('linked Blueprint materials', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({ ok: true, classroom: { id: 'classroom' } as never })
  })

  it('rejects nonowners before reading material or version data', async () => {
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect(await getClassroomBlueprintMaterials('other', 'classroom')).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(from).not.toHaveBeenCalled()
  })

  it('reads only the linked teacher-owned Blueprint latest saved Version, excluding private snapshot fields', async () => {
    const chains = setup({ materials: [material], authoring_guidance: 'Private rule', assessments: [{ answer_key: 'Private answer' }] })
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toEqual({
      ok: true, materials: { version_id: versionId, version_number: 5, materials: [material] },
    })
    expect(chains.classroom.eq).toHaveBeenCalledWith('teacher_id', 'teacher')
    expect(chains.blueprint.eq).toHaveBeenCalledWith('id', 'blueprint')
    expect(chains.blueprint.eq).toHaveBeenCalledWith('teacher_id', 'teacher')
    expect(chains.version.eq).toHaveBeenCalledWith('course_blueprint_id', 'blueprint')
    expect(chains.version.order).toHaveBeenCalledWith('version_number', { ascending: false })
    expect(chains.version.limit).toHaveBeenCalledWith(1)
  })

  it('keeps material order and does not filter to the classroom frozen Version', async () => {
    const earlier = { ...material, artifact_id: versionId, title: 'First lesson', position: 0 }
    const { version } = setup({ materials: [material, earlier] })
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toMatchObject({
      ok: true, materials: { materials: [earlier, material] },
    })
    expect(version.eq).toHaveBeenCalledTimes(1)
  })

  it('returns no linkage without reading a Blueprint', async () => {
    from.mockReturnValueOnce(query({ source_blueprint_id: null }))
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toEqual({ ok: true, materials: null })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('rejects a Blueprint the classroom owner does not own', async () => {
    from.mockReturnValueOnce(query({ source_blueprint_id: 'blueprint' })).mockReturnValueOnce(query(null))
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toMatchObject({ ok: false, status: 404 })
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('supports historical snapshots that predate Materials', async () => {
    setup({ metadata: { title: 'Old Version' } })
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toMatchObject({ ok: true, materials: { materials: [] } })
  })

  it.each([null, { materials: null }, { materials: [{ ...material, content_markdown: 123 }] }])('fails closed on malformed snapshot %j', async (snapshot) => {
    setup(snapshot)
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toMatchObject({ ok: false, status: 500 })
  })

  it('keeps a failed latest Version read distinct from empty materials', async () => {
    from.mockReturnValueOnce(query({ source_blueprint_id: 'blueprint' })).mockReturnValueOnce(query({ id: 'blueprint' }))
      .mockReturnValueOnce(query(null, { message: 'Unavailable' }))
    expect(await getClassroomBlueprintMaterials('teacher', 'classroom')).toMatchObject({ ok: false, status: 500 })
  })
})
