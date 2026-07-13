import { describe, expect, it } from 'vitest'
import {
  createSourceGraphFromSources,
  evaluateArchitectureBaseline,
  findBrowserBoundaryViolations,
  findLayerBoundaryViolations,
} from '../../scripts/lib/architecture-boundaries'

describe('architecture boundary analyzer', () => {
  it('detects forbidden lower-layer imports while allowing type-only type dependencies', () => {
    const graph = createSourceGraphFromSources({
      'src/lib/domain.ts': "import type { ButtonProps } from '@/ui'",
      'src/types/contracts.ts': "import type { DomainRecord } from '@/lib/domain'",
      'src/ui/index.ts': 'export type ButtonProps = { label: string }',
    })

    expect(findLayerBoundaryViolations(graph).map((violation) => violation.id)).toEqual([
      'layer:lib-no-presentation:src/lib/domain.ts->src/ui/index.ts',
    ])
  })

  it('traces runtime re-exports from client entries into server-only modules', () => {
    const graph = createSourceGraphFromSources({
      'src/components/ClientPanel.tsx': [
        "'use client'",
        "export { formatDraft } from '@/lib/draft-format'",
      ].join('\n'),
      'src/lib/draft-format.ts': "export { formatDraft } from '@/lib/server/draft-store'",
      'src/lib/server/draft-store.ts': 'export const formatDraft = () => null',
    })

    expect(findBrowserBoundaryViolations(graph)).toEqual([
      expect.objectContaining({
        id: 'browser-server:src/components/ClientPanel.tsx->src/lib/server/draft-store.ts',
        chain: [
          'src/components/ClientPanel.tsx',
          'src/lib/draft-format.ts',
          'src/lib/server/draft-store.ts',
        ],
      }),
    ])
  })

  it('ignores type-only imports but catches dynamic server runtime imports', () => {
    const graph = createSourceGraphFromSources({
      'src/components/ClientPanel.tsx': [
        "'use client'",
        "import type { ServerRecord } from '@/lib/server/records'",
        "export async function load() { return import('@/lib/server/loader') }",
      ].join('\n'),
      'src/lib/server/records.ts': 'export type ServerRecord = { id: string }',
      'src/lib/server/loader.ts': 'export const load = () => null',
    })

    expect(findBrowserBoundaryViolations(graph).map((violation) => violation.id)).toEqual([
      'browser-server:src/components/ClientPanel.tsx->src/lib/server/loader.ts',
    ])
  })

  it('checks shared dependencies independently for every client entry', () => {
    const graph = createSourceGraphFromSources({
      'src/components/ClientOne.tsx': ["'use client'", "import '@/lib/shared'"].join('\n'),
      'src/components/ClientTwo.tsx': ["'use client'", "import '@/lib/shared'"].join('\n'),
      'src/lib/shared.ts': "export { load } from '@/lib/server/loader'",
      'src/lib/server/loader.ts': 'export const load = () => null',
    })

    expect(findBrowserBoundaryViolations(graph).map((violation) => violation.id)).toEqual([
      'browser-server:src/components/ClientOne.tsx->src/lib/server/loader.ts',
      'browser-server:src/components/ClientTwo.tsx->src/lib/server/loader.ts',
    ])
  })

  it('blocks bare and node-prefixed Node built-ins in client modules', () => {
    const graph = createSourceGraphFromSources({
      'src/components/ClientPanel.tsx': [
        "'use client'",
        "import fs from 'fs'",
        "import path from 'node:path'",
      ].join('\n'),
    })

    expect(findBrowserBoundaryViolations(graph).map((violation) => violation.id)).toEqual([
      'browser-runtime:src/components/ClientPanel.tsx->fs',
      'browser-runtime:src/components/ClientPanel.tsx->node:path',
    ])
  })

  it('blocks relative imports that resolve to the Supabase runtime client', () => {
    const graph = createSourceGraphFromSources({
      'src/components/ClientPanel.tsx': [
        "'use client'",
        "import { getServiceRoleClient } from '../lib/supabase'",
      ].join('\n'),
      'src/lib/supabase.ts': 'export const getServiceRoleClient = () => null',
    })

    expect(findBrowserBoundaryViolations(graph).map((violation) => violation.id)).toEqual([
      'browser-server:src/components/ClientPanel.tsx->src/lib/supabase.ts',
    ])
  })

  it('reports both new violations and obsolete deletion-only baseline entries', () => {
    const result = evaluateArchitectureBaseline(
      [
        { id: 'known', rule: 'fixture', message: 'known violation' },
        { id: 'new', rule: 'fixture', message: 'new violation' },
      ],
      ['known', 'removed']
    )

    expect(result.unexpected.map((violation) => violation.id)).toEqual(['new'])
    expect(result.stale).toEqual(['removed'])
  })
})
