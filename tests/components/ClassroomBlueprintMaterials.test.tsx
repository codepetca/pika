import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClassroomBlueprintMaterials } from '@/components/ClassroomBlueprintMaterials'
import { fetchCachedJSON } from '@/lib/request-cache'

vi.mock('@/lib/request-cache', () => ({ fetchCachedJSON: vi.fn() }))
vi.mock('@/components/editor', () => ({
  RichTextViewer: ({ content }: { content: unknown }) => <div data-testid="material-content">{JSON.stringify(content)}</div>,
}))
const materials = { version_id: 'b2d18c61-0714-4e46-b93a-1920fdaaf490', version_number: 5,
  materials: [{ artifact_id: '8ad9cfa1-1c8e-4733-a16f-90cbc0a35111', title: 'Java Explained',
    content_markdown: '[Open lesson](https://example.com/java)', position: 15 }] }

describe('ClassroomBlueprintMaterials', () => {
  beforeEach(() => vi.resetAllMocks())

  it('labels latest Blueprint materials separately from classroom content and renders the saved link', async () => {
    vi.mocked(fetchCachedJSON).mockResolvedValue({ materials })
    render(<ClassroomBlueprintMaterials classroomId="p3" />)
    expect(await screen.findByRole('heading', { name: 'Java Explained' })).toBeInTheDocument()
    expect(screen.getByText('Latest saved Blueprint · Version 5')).toBeInTheDocument()
    expect(screen.getByText(/may be newer than this classroom’s Content Version/)).toBeInTheDocument()
    expect(screen.getByTestId('material-content').textContent).toContain('https://example.com/java')
    expect(fetchCachedJSON).toHaveBeenCalledWith('classroom-blueprint-materials:p3', '/api/teacher/classrooms/p3/blueprint-materials', expect.anything())
  })

  it('keeps failed reads distinct from empty lists and retries without a write', async () => {
    vi.mocked(fetchCachedJSON).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ materials: { ...materials, materials: [] } })
    render(<ClassroomBlueprintMaterials classroomId="p3" />)
    expect(await screen.findByText('Could not load materials')).toBeInTheDocument()
    expect(screen.queryByText('No materials in the latest saved Blueprint.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No materials in the latest saved Blueprint.')).toBeInTheDocument()
  })

  it('ignores an old classroom response after switching classrooms', async () => {
    let resolveOld!: (result: unknown) => void
    vi.mocked(fetchCachedJSON).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ materials: { ...materials, materials: [{ ...materials.materials[0], title: 'P5 lesson' }] } })
    const { rerender } = render(<ClassroomBlueprintMaterials classroomId="p3" />)
    rerender(<ClassroomBlueprintMaterials classroomId="p5" />)
    expect(await screen.findByRole('heading', { name: 'P5 lesson' })).toBeInTheDocument()
    resolveOld({ materials })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Java Explained' })).toBeNull())
  })

  it('treats a malformed response as a failed read', async () => {
    vi.mocked(fetchCachedJSON).mockResolvedValue({ materials: { ...materials, materials: null } })
    render(<ClassroomBlueprintMaterials classroomId="p3" />)
    expect(await screen.findByText('Could not load materials')).toBeInTheDocument()
    expect(screen.queryByText('No linked Blueprint materials.')).toBeNull()
  })
})
