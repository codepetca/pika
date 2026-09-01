import { describe, expect, it } from 'vitest'
import {
  ICON_CATALOG,
  PATTERN_CATALOG,
  REFERENCE_ROUTES,
  STATUS_CATALOG,
} from '@/app/__ui/catalog'
import { CLASSROOM_NAV_ITEMS } from '@/components/layout/classroom-nav-items'

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length)
}

describe('Pattern Lab catalog', () => {
  it('keeps pattern, icon, and status identifiers unique', () => {
    expectUnique(PATTERN_CATALOG.map((pattern) => pattern.id))
    expectUnique(ICON_CATALOG.map((icon) => icon.id))
    expectUnique(STATUS_CATALOG.map((status) => status.id))
  })

  it('documents every production classroom feature icon', () => {
    expectUnique(CLASSROOM_NAV_ITEMS.map((item) => item.id))
    expect(CLASSROOM_NAV_ITEMS.find((item) => item.id === 'today')?.label).toBe('Daily')
    expect(CLASSROOM_NAV_ITEMS.find((item) => item.id === 'today')?.lucideName).toBe('ClipboardCheck')
    expect(CLASSROOM_NAV_ITEMS.find((item) => item.id === 'tests')?.lucideName).toBe('SquarePen')
    expect(CLASSROOM_NAV_ITEMS.find((item) => item.id === 'resources')?.lucideName).toBe('Compass')
    expect(CLASSROOM_NAV_ITEMS.every((item) => item.roles.length > 0)).toBe(true)
  })

  it('maps every status to an approved icon and explicit usage guidance', () => {
    const iconIds = new Set(ICON_CATALOG.map((icon) => icon.id))

    for (const status of STATUS_CATALOG) {
      expect(iconIds.has(status.icon)).toBe(true)
      expect(status.label.length).toBeGreaterThan(0)
      expect(status.meaning.length).toBeGreaterThan(0)
      expect(status.usage.length).toBeGreaterThan(0)
    }
  })

  it('keeps stable patterns tied to an executable owner and reference', () => {
    const stablePatterns = PATTERN_CATALOG.filter((pattern) => pattern.maturity === 'stable')

    expect(stablePatterns.length).toBeGreaterThan(0)
    for (const pattern of stablePatterns) {
      expect(pattern.owner).toMatch(/^src\//)
      expect(pattern.reference.length).toBeGreaterThan(0)
      expect(pattern.useWhen.length).toBeGreaterThan(0)
      expect(pattern.avoidWhen.length).toBeGreaterThan(0)
    }
  })

  it('keeps teacher references family-scoped and linked to their existing owners', () => {
    for (const id of ['teacher-date-context', 'teacher-workspace-frame']) {
      const pattern = PATTERN_CATALOG.find((entry) => entry.id === id)
      expect(pattern?.maturity).toBe('family')
      expect(pattern?.owner).toMatch(/^src\/components\//)
      expect(pattern?.reference).toBeTruthy()
    }
  })

  it('provides deterministic reference routes for both roles', () => {
    for (const role of ['teacher', 'student'] as const) {
      expect(REFERENCE_ROUTES[role].length).toBeGreaterThan(0)
      for (const route of REFERENCE_ROUTES[role]) {
        expect(route.href).toMatch(/^\//)
        expect(route.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps relative-date text out of the shared date-navigation contract', () => {
    const pattern = PATTERN_CATALOG.find((entry) => entry.id === 'teacher-date-context')
    expect(pattern?.name).toBe('Shared date navigation')
    expect(pattern?.useWhen).not.toContain('relative')
    expect(pattern?.avoidWhen).toContain('Relative-date text is Daily-only')
  })

  it('keeps teacher-only reference surfaces out of the student catalog', () => {
    expect(REFERENCE_ROUTES.teacher).toContainEqual({
      label: 'Snapshot gallery',
      href: '/snapshots-gallery',
    })
    expect(REFERENCE_ROUTES.student).not.toContainEqual(
      expect.objectContaining({ href: '/snapshots-gallery' }),
    )
  })
})
