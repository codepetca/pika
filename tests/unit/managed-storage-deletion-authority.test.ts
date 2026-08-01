import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')
const allowedPhysicalDeletionFiles = new Set([
  'src/lib/server/classroom-purge.ts',
  'src/lib/server/course-blueprint-storage-copies.ts',
  'src/lib/server/managed-storage-blueprint-reconciliation.ts',
  'src/lib/server/managed-storage-cleanup.ts',
])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

describe('managed Storage deletion authority', () => {
  it('limits physical removal to managed cleanup, purge leases, and provisional copy targets', () => {
    const physicalDeletionFiles = sourceFiles(sourceRoot)
      .filter((path) => /\.remove\s*\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path))
      .sort()

    expect(physicalDeletionFiles).toEqual([...allowedPhysicalDeletionFiles].sort())
  })

  it('keeps legacy assignment and test cleanup workers as managed delegates', () => {
    for (const path of [
      'src/lib/server/assignment-artifact-storage-cleanup.ts',
      'src/lib/server/assignment-submission-artifacts.ts',
      'src/lib/server/test-document-snapshot-storage-cleanup.ts',
      'src/lib/server/test-document-snapshots.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), path), 'utf8')
      expect(source).toContain('queueManagedStorageCleanupPath')
      expect(source).not.toMatch(/\.remove\s*\(/)
    }
  })
})
