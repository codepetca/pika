import { describe, expect, it } from 'vitest'
import {
  courseBlueprintMaterialsToMarkdown,
  markdownToCourseBlueprintMaterials,
} from '@/lib/course-blueprint-materials'

describe('course Blueprint materials Markdown', () => {
  it('round-trips stable identity and shared classwork position', () => {
    const material = {
      artifact_id: '10000000-0000-4000-8000-000000000000',
      title: 'Reference sheet',
      content_markdown: 'Use this during the unit.',
      position: 3,
    }
    const parsed = markdownToCourseBlueprintMaterials(
      courseBlueprintMaterialsToMarkdown([material]),
      [],
      { requireArtifactIds: true, requirePositions: true }
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.materials).toEqual([material])
  })

  it('rejects missing identity-aware package metadata', () => {
    const parsed = markdownToCourseBlueprintMaterials(
      '## Reference sheet\n\nContent',
      [],
      { requireArtifactIds: true, requirePositions: true }
    )
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('missing Artifact ID'),
    ]))
  })
})
