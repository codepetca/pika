'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  Button,
  Card,
  FormField,
  Input,
  PageState,
  SaveStatus,
  SegmentedControl,
  Select,
  Tabs,
  Tooltip,
  cn,
} from '@/ui'
import { useTheme } from '@/contexts/ThemeContext'
import type { AssignmentDocHistoryEntry } from '@/types'
import { HistoryGraph } from '@/components/HistoryGraph'
import {
  ICON_CATALOG,
  PATTERN_CATALOG,
  REFERENCE_ROUTES,
  STATUS_CATALOG,
  type ApprovedIconName,
  type PatternMaturity,
  type StatusCatalogEntry,
  type StatusTone,
} from './catalog'
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  Inbox,
  Info,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

type Role = 'teacher' | 'student'

interface Props {
  role: Role
}

export function UiGallery({ role }: Props) {
  const { theme, mounted, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [dialogOpen, setDialogOpen] = useState(false)
  const referenceRoutes = REFERENCE_ROUTES[role]

  return (
    <main className="min-h-screen bg-page text-text-default">
      <div className="mx-auto max-w-wide space-y-8 px-4 py-8 sm:px-6">
        <header className="space-y-5" data-testid="pattern-lab-header">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                <span>Pika design system</span>
                <span aria-hidden="true">·</span>
                <span>{role} reference</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Pattern Lab</h1>
              <p className="mt-2 text-sm leading-6 text-text-muted sm:text-base">
                Executable examples of Pika&apos;s approved controls, symbols, statuses, and page states.
                Production components remain the source of truth; this page makes their contracts easy to inspect.
              </p>
            </div>
            <Button type="button" variant="surface" size="sm" onClick={toggleTheme}>
              {mounted && theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            </Button>
          </div>

          <nav aria-label="Pattern Lab sections" className="flex gap-2 overflow-x-auto pb-1">
            {[
              ['catalog', 'Catalog'],
              ['controls', 'Controls'],
              ['icons', 'Icons'],
              ['statuses', 'Statuses'],
              ['page-states', 'Page states'],
              ['feature-patterns', 'Feature patterns'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={`#${href}`}
                className="inline-flex min-h-control shrink-0 items-center rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium text-text-default transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus"
              >
                {label}
              </a>
            ))}
          </nav>

          <Card tone="panel" padding="sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Reference surfaces</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Use these alongside the catalog when comparing a complete {role} workflow.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {referenceRoutes.map((route) => (
                  <Link
                    key={route.href}
                    href={route.href}
                    className="inline-flex min-h-control items-center rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus"
                  >
                    {route.label}
                  </Link>
                ))}
              </div>
            </div>
          </Card>
        </header>

        <PatternSection
          id="catalog"
          eyebrow="Governance"
          title="Pattern catalog"
          description="Start every UI change here: name the closest owner, then decide whether to reuse, extend, or create. Experimental entries require human promotion before they become defaults."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PATTERN_CATALOG.map((pattern) => (
              <Card key={pattern.id} tone="panel" padding="md">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{pattern.name}</h3>
                    <code className="mt-1 block text-xs text-text-muted">{pattern.owner}</code>
                  </div>
                  <MaturityBadge maturity={pattern.maturity} />
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-success">Use when</dt>
                    <dd className="mt-0.5 text-text-muted">{pattern.useWhen}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-danger">Avoid when</dt>
                    <dd className="mt-0.5 text-text-muted">{pattern.avoidWhen}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Reference</dt>
                    <dd className="mt-0.5 break-words text-text-muted">{pattern.reference}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </PatternSection>

        <div data-testid="pattern-lab-contracts" className="space-y-8">
          <PatternSection
            id="controls"
            eyebrow="Stable foundation"
            title="Core controls"
            description="These examples render the canonical @/ui owners. Feature code should compose them instead of reproducing their geometry, focus, or disabled states."
          >
          <div className="space-y-5">
            <Card tone="panel" padding="md">
              <PatternHeading title="Buttons" owner="src/ui/Button.tsx" />
              <div className="mt-4 flex flex-wrap gap-3">
                <Button size="sm">Primary</Button>
                <Button size="sm" variant="secondary">Secondary</Button>
                <Button size="sm" variant="surface">Surface</Button>
                <Button size="sm" variant="subtle">Subtle</Button>
                <Button size="sm" variant="success">Success</Button>
                <Button size="sm" variant="danger">Danger</Button>
                <Button size="sm" variant="ghost">Ghost</Button>
                <Button size="sm" loading>Saving</Button>
                <Button size="sm" disabled>Disabled</Button>
                <Tooltip content="Edit example" side="top">
                  <Button type="button" size="sm" variant="surface" className="px-0" aria-label="Edit example">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card tone="panel" padding="md">
                <PatternHeading title="Form fields" owner="src/ui/FormField.tsx" />
                <div className="mt-4 space-y-4">
                  <FormField label="Class name" hint="Use the name students already recognize." required>
                    <Input defaultValue="Computer Science 11" />
                  </FormField>
                  <FormField label="Term" error="Choose an active term.">
                    <Select
                      defaultValue=""
                      placeholder="Choose a term"
                      options={[
                        { value: 'semester-1', label: 'Semester 1' },
                        { value: 'semester-2', label: 'Semester 2' },
                      ]}
                    />
                  </FormField>
                  <FormField label="Archived field">
                    <Input defaultValue="Unavailable in this state" disabled />
                  </FormField>
                </div>
              </Card>

              <Card tone="panel" padding="md">
                <PatternHeading title="Content surfaces" owner="src/ui/Card.tsx" />
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(['default', 'muted', 'panel', 'accent', 'selected'] as const).map((tone) => (
                    <Card key={tone} tone={tone} padding="sm">
                      <p className="text-sm font-semibold capitalize">{tone}</p>
                      <p className="mt-1 text-xs text-text-muted">Semantic surface tone</p>
                    </Card>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-4" aria-label="Save status examples">
                  <SaveStatus status="saved" />
                  <SaveStatus status="saving" />
                  <SaveStatus status="unsaved" />
                  <SaveStatus status="error" errorMessage="Save failed" />
                </div>
              </Card>
            </div>

            <Card tone="panel" padding="md">
              <PatternHeading title="Selection controls" owner="src/ui/Tabs.tsx; src/ui/SegmentedControl.tsx" />
              <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <Tabs
                    ariaLabel="Pattern example panels"
                    value={activeTab}
                    onValueChange={setActiveTab}
                    items={[
                      { value: 'details', label: 'Details' },
                      { value: 'history', label: 'History' },
                    ]}
                  />
                  <div className="min-h-20 border-x border-b border-border bg-surface px-4 py-3 text-sm text-text-muted">
                    {activeTab === 'details'
                      ? 'Tabs own panel navigation and keyboard behaviour.'
                      : 'History is another panel in the same local context.'}
                  </div>
                </div>
                <div>
                  <SegmentedControl
                    ariaLabel="Content density"
                    value={density}
                    onChange={setDensity}
                    options={[
                      { value: 'comfortable', label: 'Comfortable' },
                      { value: 'compact', label: 'Compact' },
                    ]}
                  />
                  <p className="mt-3 text-sm text-text-muted">
                    Segmented controls change a peer mode; they do not replace navigation tabs.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button type="button" variant="surface" size="sm" onClick={() => setDialogOpen(true)}>
                  Open alert dialog
                </Button>
                <span className="text-xs text-text-muted">Dialogs preserve focus, Escape, and overlay ownership.</span>
              </div>
            </Card>
          </div>
          </PatternSection>

          <PatternSection
            id="icons"
            eyebrow="Approved symbols"
            title="Icon catalog"
            description="Lucide is Pika's default icon source. Symbols clarify meaning but do not replace visible labels, accessible names, or product-specific status language."
          >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ICON_CATALOG.map((icon) => {
              const Icon = ICON_COMPONENTS[icon.id]
              return (
                <Card key={icon.id} tone="panel" padding="sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{icon.label}</h3>
                        <span className="rounded-badge bg-surface-2 px-2 py-0.5 text-xs text-text-muted">
                          {icon.category}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-text-default">{icon.meaning}</p>
                      <p className="mt-1 text-xs leading-5 text-text-muted">{icon.rule}</p>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          <Card tone="accent" padding="sm" className="mt-4">
            <p className="text-sm font-medium">Icon governance</p>
            <p className="mt-1 text-sm text-text-muted">
              Prefer an approved Lucide symbol. A custom asset needs a documented semantic gap and review.
              Emoji, text glyphs, and handcrafted SVG approximations are not interface icons.
            </p>
          </Card>
          </PatternSection>

          <PatternSection
            id="statuses"
            eyebrow="Semantic language"
            title="Status symbols and labels"
            description="These are cross-product examples, not a universal domain component. Attendance, submissions, tests, and other workflows keep their precise labels and behaviour."
          >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {STATUS_CATALOG.map((status) => (
              <StatusExample key={status.id} status={status} />
            ))}
          </div>
          <Card tone="muted" padding="sm" className="mt-4">
            <p className="text-sm font-semibold">Domain rule</p>
            <p className="mt-1 text-sm text-text-muted">
              Prefer precise labels such as Present, Late, Absent, Submitted, Returned, or Missing.
              Reuse a shared status owner only when both meaning and behaviour match—not merely the colour or icon.
            </p>
          </Card>
          </PatternSection>

          <PatternSection
            id="page-states"
            eyebrow="Route responsibility"
            title="Page states"
            description="Loading, error, empty, and forbidden are deliberately different. Keep the surrounding shell mounted whenever possible."
          >
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card tone="panel" padding="none"><PageState compact kind="loading" title="Loading classroom" description="The initial read is still pending." /></Card>
            <Card tone="panel" padding="none"><PageState compact kind="error" title="Could not load classroom" description="A required read failed." action={<Button size="sm">Try again</Button>} /></Card>
            <Card tone="panel" padding="none"><PageState compact kind="empty" title="No assignments yet" description="The read succeeded and returned no records." action={<Button size="sm">Create assignment</Button>} /></Card>
            <Card tone="panel" padding="none"><PageState compact kind="forbidden" title="Page unavailable" description="The current identity cannot use this surface." /></Card>
          </div>
          </PatternSection>
        </div>

        <PatternSection
          id="feature-patterns"
          eyebrow="Feature-owned evidence"
          title="Feature patterns"
          description="Feature compositions remain here when their behaviour is not a stable cross-product primitive. Promotion requires multiple adopters and a durable shared contract."
        >
          <HistoryGraphGallery />
        </PatternSection>
      </div>

      <AlertDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Pattern confirmed"
        description="This dialog is rendered by the canonical shared owner."
        variant="success"
        buttonLabel="Close example"
      />
    </main>
  )
}

const ICON_COMPONENTS: Record<ApprovedIconName, LucideIcon> = {
  'check-circle': CheckCircle2,
  clock: Clock3,
  'alert-circle': CircleAlert,
  info: Info,
  lock: LockKeyhole,
  loader: LoaderCircle,
  inbox: Inbox,
  pencil: Pencil,
  trash: Trash2,
  'external-link': ExternalLink,
  'chevron-down': ChevronDown,
  menu: Menu,
}

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-success bg-success-bg text-success',
  warning: 'border-warning bg-warning-bg text-warning',
  danger: 'border-danger bg-danger-bg text-danger',
  info: 'border-primary bg-info-bg text-info',
  neutral: 'border-border bg-surface-2 text-text-muted',
}

const MATURITY_CLASSES: Record<PatternMaturity, string> = {
  stable: 'bg-success-bg text-success',
  family: 'bg-info-bg text-info',
  experimental: 'bg-warning-bg text-warning',
}

function PatternSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section id={id} data-testid={`pattern-section-${id}`} className="scroll-mt-6">
      <div className="mb-4 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}

function PatternHeading({ title, owner }: { title: string; owner: string }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <code className="mt-1 block text-xs text-text-muted">{owner}</code>
    </div>
  )
}

function MaturityBadge({ maturity }: { maturity: PatternMaturity }) {
  return (
    <span className={cn('rounded-badge px-2 py-0.5 text-xs font-semibold capitalize', MATURITY_CLASSES[maturity])}>
      {maturity}
    </span>
  )
}

function StatusExample({ status }: { status: StatusCatalogEntry }) {
  const Icon = ICON_COMPONENTS[status.icon]

  return (
    <Card tone="panel" padding="md">
      <div className="flex items-start gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-control border', STATUS_TONE_CLASSES[status.tone])}>
          <Icon className={cn('h-5 w-5', status.icon === 'loader' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{status.label}</h3>
            <span className={cn('rounded-badge border px-2 py-0.5 text-xs font-semibold', STATUS_TONE_CLASSES[status.tone])}>
              {status.tone}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-default">{status.meaning}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">{status.usage}</p>
        </div>
      </div>
    </Card>
  )
}

// ── History Graph Gallery ──────────────────────────────────────────

function makeEntry(
  id: string,
  charCount: number,
  createdAt: string,
  trigger: AssignmentDocHistoryEntry['trigger'] = 'autosave'
): AssignmentDocHistoryEntry {
  return {
    id,
    assignment_doc_id: 'doc-1',
    patch: null,
    snapshot: null,
    word_count: Math.round(charCount / 5),
    char_count: charCount,
    paste_word_count: null,
    keystroke_count: null,
    trigger,
    created_at: createdAt,
  }
}

// Newest-first (as from DB)
const SCENARIOS: { label: string; entries: AssignmentDocHistoryEntry[] }[] = [
  {
    label: 'Normal session — 18 entries, all additions',
    entries: [
      makeEntry('n18', 520, '2025-01-15T19:34:00Z'),
      makeEntry('n17', 500, '2025-01-15T19:30:00Z'),
      makeEntry('n16', 475, '2025-01-15T19:26:00Z'),
      makeEntry('n15', 450, '2025-01-15T19:22:00Z'),
      makeEntry('n14', 430, '2025-01-15T19:18:00Z'),
      makeEntry('n13', 405, '2025-01-15T19:14:00Z'),
      makeEntry('n12', 385, '2025-01-15T19:10:00Z'),
      makeEntry('n11', 360, '2025-01-15T19:06:00Z'),
      makeEntry('n10', 340, '2025-01-15T19:02:00Z'),
      makeEntry('n09', 310, '2025-01-15T18:58:00Z'),
      makeEntry('n08', 285, '2025-01-15T18:54:00Z'),
      makeEntry('n07', 260, '2025-01-15T18:50:00Z'),
      makeEntry('n06', 230, '2025-01-15T18:46:00Z'),
      makeEntry('n05', 200, '2025-01-15T18:42:00Z'),
      makeEntry('n04', 165, '2025-01-15T18:38:00Z'),
      makeEntry('n03', 125, '2025-01-15T18:34:00Z'),
      makeEntry('n02', 80, '2025-01-15T18:30:00Z'),
      makeEntry('n01', 30, '2025-01-15T18:26:00Z', 'baseline'),
    ],
  },
  {
    label: 'Mixed session — additions and deletions',
    entries: [
      makeEntry('m10', 320, '2025-01-15T19:20:00Z'),
      makeEntry('m09', 280, '2025-01-15T19:16:00Z'),
      makeEntry('m08', 350, '2025-01-15T19:12:00Z'),
      makeEntry('m07', 310, '2025-01-15T19:08:00Z'),
      makeEntry('m06', 370, '2025-01-15T19:04:00Z'),
      makeEntry('m05', 340, '2025-01-15T19:00:00Z'),
      makeEntry('m04', 290, '2025-01-15T18:56:00Z'),
      makeEntry('m03', 250, '2025-01-15T18:52:00Z'),
      makeEntry('m02', 180, '2025-01-15T18:48:00Z'),
      makeEntry('m01', 100, '2025-01-15T18:44:00Z', 'baseline'),
    ],
  },
  {
    label: 'Gap — two sessions with 30-min break',
    entries: [
      makeEntry('g08', 480, '2025-01-15T20:08:00Z'),
      makeEntry('g07', 440, '2025-01-15T20:04:00Z'),
      makeEntry('g06', 400, '2025-01-15T20:00:00Z'),
      makeEntry('g05', 360, '2025-01-15T19:56:00Z'),
      // 30-min gap
      makeEntry('g04', 300, '2025-01-15T19:22:00Z'),
      makeEntry('g03', 240, '2025-01-15T19:18:00Z'),
      makeEntry('g02', 170, '2025-01-15T19:14:00Z'),
      makeEntry('g01', 100, '2025-01-15T19:10:00Z', 'baseline'),
    ],
  },
  {
    label: 'Large paste — one +500 entry (warning)',
    entries: [
      makeEntry('p05', 700, '2025-01-15T19:16:00Z'),
      makeEntry('p04', 680, '2025-01-15T19:12:00Z'),
      makeEntry('p03', 650, '2025-01-15T19:08:00Z'),
      makeEntry('p02', 120, '2025-01-15T19:04:00Z'),
      makeEntry('p01', 100, '2025-01-15T19:00:00Z', 'baseline'),
    ],
  },
  {
    label: 'Single entry — just baseline',
    entries: [
      makeEntry('s01', 50, '2025-01-15T18:00:00Z', 'baseline'),
    ],
  },
  {
    label: 'Empty — no entries',
    entries: [],
  },
  {
    label: 'Dense — 80+ entries in one day',
    entries: Array.from({ length: 82 }, (_, i) => {
      const idx = 82 - i // newest first
      const mins = idx * 2
      const hour = Math.floor(mins / 60) + 15
      const min = mins % 60
      const time = `2025-01-15T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`
      const charCount = 50 + idx * 6 + (idx % 3 === 0 ? -10 : 0)
      return makeEntry(
        `d${String(idx).padStart(2, '0')}`,
        charCount,
        time,
        idx === 1 ? 'baseline' : 'autosave'
      )
    }),
  },
  {
    label: 'Multi-day — work across two days',
    entries: [
      makeEntry('md06', 400, '2025-01-16T19:08:00Z'),
      makeEntry('md05', 360, '2025-01-16T19:04:00Z'),
      makeEntry('md04', 300, '2025-01-16T19:00:00Z'),
      makeEntry('md03', 250, '2025-01-15T20:04:00Z'),
      makeEntry('md02', 180, '2025-01-15T20:00:00Z'),
      makeEntry('md01', 100, '2025-01-15T19:56:00Z', 'baseline'),
    ],
  },
]

function HistoryGraphGallery() {
  const [lastEvent, setLastEvent] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  return (
    <div className="bg-surface rounded-lg shadow-sm p-4">
      <h2 className="text-lg font-semibold text-text-default">History Graph</h2>
      <p className="text-text-muted text-sm mt-1">
        SVG timeline charts at sidebar widths. Hover to see tooltips, click stems to select.
      </p>

      {lastEvent && (
        <div className="mt-2 text-xs font-mono bg-surface-2 rounded px-2 py-1 text-text-muted">
          {lastEvent}
        </div>
      )}

      <div className="mt-4 space-y-6">
        {SCENARIOS.map((scenario) => (
          <div key={scenario.label}>
            <div className="text-sm font-medium text-text-default mb-2">
              {scenario.label}
            </div>
            <div className="flex gap-4 flex-wrap">
              {[256, 240].map((w) => (
                <div
                  key={w}
                  className="border border-border rounded"
                  style={{ width: w }}
                >
                  <div className="text-[10px] text-text-muted px-2 pt-1">
                    {w}px
                  </div>
                  <HistoryGraph
                    entries={scenario.entries}
                    activeEntryId={activeId}
                    onEntryClick={(entry) => {
                      setActiveId(entry.id)
                      setLastEvent(`click: ${entry.id} (${entry.char_count} chars)`)
                    }}
                    onEntryHover={(entry) => {
                      setLastEvent(`hover: ${entry.id} (${entry.char_count} chars)`)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
