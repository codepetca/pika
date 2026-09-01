'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  Button,
  Card,
  FormField,
  Input,
  IconButton,
  PageActionBar,
  PageHeading,
  PageState,
  SaveStatus,
  SegmentedControl,
  Select,
  TabPanel,
  Tabs,
  Tooltip,
  cn,
} from '@/ui'
import { useTheme } from '@/contexts/ThemeContext'
import type { AssignmentDocHistoryEntry, TiptapContent } from '@/types'
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
  Plus,
  RotateCw,
  MoreVertical,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { RichTextEditor, RichTextViewer } from '@/components/editor'
import type { HistoryPreviewMode } from '@/hooks/useHistoryPreviewViewport'
import { buildAssignmentHistoryPreview } from '@/lib/assignment-doc-history'
import { TeacherPatterns } from './TeacherPatterns'
import { StudentTestListItem } from '@/components/StudentTestListItem'
import type { StudentTestSummary } from '@/lib/student-test-presentation'
import { StatusPatterns } from './StatusPatterns'
import { MaterialCreationPattern } from './MaterialCreationPattern'
import { AssignmentCreationPattern } from './AssignmentCreationPattern'
import { StudentAssignmentAttachmentsPattern } from './StudentAssignmentAttachmentsPattern'
import { PageMockups } from './PageMockups'
import { CLASSROOM_NAV_ITEMS } from '@/components/layout/classroom-nav-items'

type Role = 'teacher' | 'student'

interface PatternLabDestination {
  value: string
  label: string
}

const QUICK_LINK_LABELS: Record<string, string> = {
  'page-mockups': 'Page mockups',
  'page-actions': 'Page actions',
  'status-colors': 'Status colors',
  'assignment-creation': 'Assignment dialog',
  controls: 'Controls',
  'student-tests': 'Student tests',
  'history-preview': 'History preview',
}

interface Props {
  role: Role
}

export function UiGallery({ role }: Props) {
  const { theme, mounted, toggleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [dialogOpen, setDialogOpen] = useState(false)
  const referenceRoutes = REFERENCE_ROUTES[role]
  const navigationDestinations = getPatternLabDestinations(role)
  const quickLinkIds = role === 'teacher'
    ? ['page-mockups', 'page-actions', 'status-colors', 'assignment-creation']
    : ['controls', 'status-colors', 'student-tests', 'history-preview']
  const quickLinks = quickLinkIds
    .map((id) => navigationDestinations.find((destination) => destination.value === id))
    .filter((destination): destination is PatternLabDestination => Boolean(destination))

  function jumpToPattern(targetId: string) {
    const target = document.getElementById(targetId)
    if (!target) return
    window.history.replaceState(null, '', `#${targetId}`)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const owningTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"][aria-controls]'))
      .find((tab) => tab.getAttribute('aria-controls') === targetId)
    const scroll = () => target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    if (owningTab && owningTab.getAttribute('aria-selected') !== 'true') {
      owningTab.click()
      window.requestAnimationFrame(scroll)
      return
    }
    scroll()
  }

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

          <nav aria-label="Pattern Lab overview sections" className="flex gap-2 overflow-x-auto pb-1">
            {[
              ['catalog', 'Catalog'],
              ['controls', 'Controls'],
              ['icons', 'Icons'],
              ['statuses', 'Statuses'],
              ['page-states', 'Page states'],
              ...(role === 'teacher' ? [['teacher-patterns', 'Teacher patterns']] : []),
              ...(role === 'teacher' ? [['page-mockups', 'Page mockups']] : []),
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

        <nav
          aria-label="Pattern Lab sections"
          className="sticky top-2 z-app-chrome -mx-1 rounded-card border border-border bg-surface p-2 shadow-sm"
        >
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <label htmlFor="pattern-lab-jump" className="mb-1 block text-xs font-semibold text-text-muted">
                Find a pattern
              </label>
              <Select
                id="pattern-lab-jump"
                defaultValue=""
                placeholder="Jump to a section…"
                options={navigationDestinations}
                onChange={(event) => {
                  jumpToPattern(event.currentTarget.value)
                  event.currentTarget.value = ''
                }}
              />
            </div>
            <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto lg:flex">
              <span className="shrink-0 text-xs font-semibold text-text-muted">Quick links</span>
              {quickLinks.map((destination) => (
                <a
                  key={destination.value}
                  href={`#${destination.value}`}
                  className="inline-flex min-h-control shrink-0 items-center rounded-control border border-border bg-page px-3 py-2 text-sm font-medium text-text-default transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus"
                >
                  {QUICK_LINK_LABELS[destination.value]}
                </a>
              ))}
            </div>
          </div>
        </nav>

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
                  <div className="min-w-0">
                    <h3 className="font-semibold">{pattern.name}</h3>
                    <code className="mt-1 block break-words text-xs text-text-muted">{pattern.owner}</code>
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

        <div data-testid="pattern-lab-contracts" className="scroll-mt-28 space-y-8">
          <PatternSection
            id="controls"
            eyebrow="Stable foundation"
            title="Core controls"
            description="These examples render the canonical @/ui owners. Feature code should compose them instead of reproducing their geometry, focus, or disabled states."
          >
          <div className="space-y-5">
            <div id="page-actions" data-testid="page-action-icons-example" className="scroll-mt-28">
              <Card tone="panel" padding="md">
                <PatternHeading title="Page actions" owner="src/ui/Page.tsx; src/ui/IconButton.tsx" />
                <div className="mt-4">
                  <PageActionBar
                    primary={<PageHeading title="Assignments" size="section" />}
                    actions={[
                      { id: 'create', label: 'Create assignment', icon: Plus, primary: true, onSelect: () => setDialogOpen(true) },
                      { id: 'export', label: 'Export assignments', onSelect: () => setDialogOpen(true) },
                      { id: 'unavailable', label: 'Archive selected', disabled: true, onSelect: () => undefined },
                    ]}
                  />
                </div>
                <p className="mt-3 text-xs text-text-muted">Create with + in the center. Hover or focus for context. More actions stays at the far right.</p>
              </Card>
            </div>
            <div className="[&>section]:scroll-mt-28">
              <StatusPatterns />
            </div>
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
                    getTabId={(value) => `pattern-${value}-tab`}
                    getPanelId={(value) => `pattern-${value}-panel`}
                    items={[
                      { value: 'details', label: 'Details' },
                      { value: 'history', label: 'History' },
                    ]}
                  />
                  {([
                    ['details', 'Tabs own panel navigation and keyboard behaviour.'],
                    ['history', 'History is another panel in the same local context.'],
                  ] as const).map(([value, copy]) => (
                    <TabPanel
                      key={value}
                      id={`pattern-${value}-panel`}
                      labelledBy={`pattern-${value}-tab`}
                      className={cn(
                        'min-h-20 border-x border-b border-border bg-surface px-4 py-3 text-sm text-text-muted',
                        activeTab !== value && 'hidden',
                      )}
                    >
                      {copy}
                    </TabPanel>
                  ))}
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
          <div className="mt-6">
            <PatternHeading
              title="Classroom navigation"
              owner="src/components/layout/classroom-nav-items.ts"
            />
            <p className="mt-1 text-sm text-text-muted">
              Exact feature symbols shared by the production classroom sidebar and this catalog.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CLASSROOM_NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <Card key={item.id} tone="panel" padding="sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-border bg-surface-2">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{item.label}</h3>
                        <p className="mt-1 text-sm text-text-default">{item.lucideName}</p>
                        <p className="mt-1 text-xs capitalize text-text-muted">
                          {item.roles.join(' · ')}
                        </p>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
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
          <p className="mb-4 text-sm">
            <Link href="#status-colors" className="text-primary underline">View Attendance, Classwork, and Test colors and count chips</Link>
          </p>
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
            <Card tone="panel" padding="none"><PageState compact kind="error" title="Could not load classroom" description="A required read failed." action={<IconButton icon={RotateCw} label="Try again" onClick={() => setDialogOpen(true)} />} /></Card>
            <Card tone="panel" padding="none"><PageState compact kind="empty" title="No assignments yet" description="The read succeeded and returned no records." action={<IconButton icon={Plus} label="Create assignment" onClick={() => setDialogOpen(true)} />} /></Card>
            <Card tone="panel" padding="none"><PageState compact kind="forbidden" title="Page unavailable" description="The current identity cannot use this surface." /></Card>
          </div>
          </PatternSection>
        </div>

        {role === 'teacher' && (
          <PatternSection
            id="teacher-patterns"
            eyebrow="Teacher-family evidence"
            title="Teacher work surfaces"
            description="Real shared owners, reconciled with the merged Daily refinements. These examples document the existing teacher family; they do not promote Daily-specific choices into global rules."
          >
            <TeacherPatterns />
          </PatternSection>
        )}

        {role === 'teacher' && (
          <PatternSection
            id="page-mockups"
            eyebrow="Experimental · page compositions"
            title="Classroom page patterns"
            description="Interactive controls and representative content for Classrooms, Gradebook, Calendar, Announcements, Roster, Settings, and selected Classwork/Test workspaces. These local-only fixtures support comparison before live-page implementation."
          >
            <PageMockups />
          </PatternSection>
        )}

        <PatternSection
          id="feature-patterns"
          eyebrow="Feature-owned evidence"
          title="Feature patterns"
          description="Feature compositions remain here when their behaviour is not a stable cross-product primitive. Promotion requires multiple adopters and a durable shared contract."
        >
          <div className="space-y-6 [&>section]:scroll-mt-28">
            {role === 'teacher' && <MaterialCreationPattern />}
            {role === 'teacher' && <AssignmentCreationPattern />}
            {role === 'student' && <StudentAssignmentAttachmentsPattern />}
          <PatternSection
            id="student-tests"
            eyebrow="Experimental · student workflow"
            title="Student Tests: progress and access"
            description="Real list actions with fixed examples. Submitted and Returned describe progress; Closed describes access. This refinement awaits human review and is not a cross-product default."
          >
            <StudentTestExamples />
          </PatternSection>

            <HistoryPreviewGallery role={role} />
            <HistoryGraphGallery />
          </div>
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
  plus: Plus,
  refresh: RotateCw,
  'more-actions': MoreVertical,
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

function getPatternLabDestinations(role: Role): PatternLabDestination[] {
  return [
    { value: 'catalog', label: 'Overview — Pattern catalog' },
    { value: 'controls', label: 'Controls — Buttons, fields, tabs, and dialogs' },
    { value: 'page-actions', label: 'Controls — Page action bar' },
    { value: 'icons', label: 'Icons — Approved symbols' },
    { value: 'statuses', label: 'Statuses — Labels and meanings' },
    { value: 'status-colors', label: 'Statuses — Attendance, classwork, and test colors' },
    { value: 'page-states', label: 'Page states — Loading, error, empty, and unavailable' },
    ...(role === 'teacher' ? [
      { value: 'teacher-patterns', label: 'Teacher patterns — Page shells and action bars' },
      { value: 'page-mockups', label: 'Page mockups — Classrooms, gradebook, calendar, announcements, roster, settings, and workspaces' },
      { value: 'mockup-classrooms-panel', label: 'Page mockups — Classrooms' },
      { value: 'mockup-gradebook-panel', label: 'Page mockups — Gradebook' },
      { value: 'mockup-calendar-panel', label: 'Page mockups — Calendar' },
      { value: 'mockup-announcements-panel', label: 'Page mockups — Announcements' },
      { value: 'mockup-roster-panel', label: 'Page mockups — Roster' },
      { value: 'mockup-settings-panel', label: 'Page mockups — Settings' },
      { value: 'mockup-workspaces-panel', label: 'Page mockups — Classwork and Tests workspaces' },
      { value: 'material-creation', label: 'Creation dialogs — Material' },
      { value: 'assignment-creation', label: 'Creation dialogs — Assignment' },
    ] : []),
    { value: 'student-tests', label: 'Student tests — Progress and access' },
    { value: 'history-preview', label: 'History — Document preview' },
    { value: 'history-graph', label: 'History — Activity graph scenarios' },
  ]
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
    <section id={id} data-testid={`pattern-section-${id}`} className="scroll-mt-28">
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

const STUDENT_TEST_EXAMPLES: StudentTestSummary[] = [
  { title: 'Functions and Graphs', status: 'active', student_status: 'not_started', effective_access: 'open' },
  { title: 'Polynomial Expressions and Rational Functions — Unit Review', status: 'closed', student_status: 'not_started', effective_access: 'closed' },
  { title: 'Linear Equations', status: 'active', student_status: 'responded', effective_access: 'open' },
  { title: 'Quadratic Relations', status: 'closed', student_status: 'responded', effective_access: 'closed' },
  { title: 'Rates of Change', status: 'closed', student_status: 'can_view_results', effective_access: 'closed' },
]

function StudentTestExamples() {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">src/components/StudentTestListItem.tsx · Preview only; no test opens or starts.</p>
      <div className="space-y-3">
        {STUDENT_TEST_EXAMPLES.map((test) => (
          <StudentTestListItem key={test.title} test={test} selected={selected === test.title} onClick={() => setSelected(test.title)} />
        ))}
      </div>
      <p role="status" className="text-sm text-text-muted">
        {selected ? `Selected example: ${selected}` : 'Select an available example to inspect its focus and selection treatment.'}
      </p>
    </div>
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

function makePreviewContent(paragraphCount: number): TiptapContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Field Study Reflection' }],
      },
      ...Array.from({ length: paragraphCount }, (_, index) => ({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `Section ${index + 1}. This saved response records an observation, the evidence that supports it, and the student’s developing interpretation of what happened during the field study.`,
        }],
      })),
    ],
  }
}

const PREVIEW_CONTENT = makePreviewContent(40)

function HistoryPreviewGallery({ role }: { role: Role }) {
  const [previewMode, setPreviewMode] = useState<HistoryPreviewMode>('current')
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const entries = FOCUSED_PREVIEW_ENTRIES
  const isTeacher = role === 'teacher'

  useEffect(() => {
    setActiveEntryId('preview-3')
    setPreviewMode('focused')
  }, [])

  const preview = useMemo(() => {
    if (!activeEntryId) return null
    return buildAssignmentHistoryPreview([...entries].reverse(), activeEntryId)
  }, [activeEntryId, entries])
  const previewContent = preview?.content ?? PREVIEW_CONTENT

  return (
    <div id="history-preview" data-testid="history-preview-gallery" className="scroll-mt-28 bg-surface rounded-lg shadow-sm p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text-default">
            {isTeacher ? 'Teacher' : 'Student'} history preview
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            A mid-project save is previewed. Hover another save, or click to pin it.
          </p>
        </div>
        {previewMode !== 'current' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPreviewMode('current')
              setActiveEntryId(null)
            }}
          >
            Exit preview
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex h-96 min-h-0 flex-col overflow-hidden rounded-lg border border-border md:flex-row">
        <div
          data-testid="history-preview-document-pane"
          className={previewMode === 'current'
            ? 'min-h-0 flex-1 bg-surface'
            : 'min-h-0 flex-1 bg-surface ring-1 ring-inset ring-primary'}
        >
          {isTeacher ? (
            <RichTextViewer
              content={previewContent}
              fillHeight
              chrome="flush"
              historyPreviewMode={previewMode}
              historyPreviewChange={preview?.change}
            />
          ) : (
            <RichTextEditor
              content={previewContent}
              onChange={() => undefined}
              editable={false}
              className="h-full"
              historyPreviewMode={previewMode}
              historyPreviewChange={preview?.change}
            />
          )}
        </div>
        <div
          className="w-full shrink-0 border-t border-border bg-page md:w-60 md:border-l md:border-t-0"
          onMouseLeave={() => {
            if (previewMode === 'focused') {
              setPreviewMode('current')
              setActiveEntryId(null)
            }
          }}
        >
          <HistoryGraph
            entries={entries}
            activeEntryId={activeEntryId}
            audience={role}
            showHeading={false}
            hoverEnabled={previewMode !== 'locked'}
            onEntryHover={(entry) => {
              if (previewMode === 'locked') return
              setActiveEntryId(entry.id)
              setPreviewMode('focused')
            }}
            onEntryClick={(entry) => {
              setActiveEntryId(entry.id)
              setPreviewMode('locked')
            }}
          />
        </div>
      </div>
    </div>
  )
}

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

function clonePreviewContent(content: TiptapContent): TiptapContent {
  return JSON.parse(JSON.stringify(content)) as TiptapContent
}

function makeFocusedPreviewEntries(): AssignmentDocHistoryEntry[] {
  const baseline = makePreviewContent(8)
  const rewrite = clonePreviewContent(baseline)
  rewrite.content![6] = {
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'Section 6. The student rewrote this interpretation to connect the soil sample, the weather record, and the field observation more clearly.',
    }],
  }

  const addition = clonePreviewContent(rewrite)
  addition.content!.push(...makePreviewContent(20).content!.slice(9))
  addition.content!.splice(13, 0, {
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'New evidence. The shaded plot retained more moisture than the exposed plot after the afternoon temperature increased.',
    }],
  })

  const deletion = clonePreviewContent(addition)
  deletion.content!.splice(4, 1)

  const latest = clonePreviewContent(deletion)
  latest.content!.push(...makePreviewContent(40).content!.slice(21))
  latest.content![34] = {
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'Section 34. The conclusion now distinguishes what the evidence demonstrates from what would require another observation.',
    }],
  }

  return [
    { ...makeEntry('preview-5', 6120, '2025-03-14T18:20:00Z'), snapshot: latest },
    { ...makeEntry('preview-4', 3100, '2025-03-13T19:05:00Z'), snapshot: deletion },
    { ...makeEntry('preview-3', 3260, '2025-03-12T17:40:00Z'), snapshot: addition },
    { ...makeEntry('preview-2', 1380, '2025-03-11T20:10:00Z'), snapshot: rewrite },
    { ...makeEntry('preview-1', 1320, '2025-03-10T18:00:00Z', 'baseline'), snapshot: baseline },
  ]
}

const FOCUSED_PREVIEW_ENTRIES = makeFocusedPreviewEntries()

function makeSteadyProjectEntries(): AssignmentDocHistoryEntry[] {
  const chronological: AssignmentDocHistoryEntry[] = []
  let charCount = 90

  for (let day = 0; day < 42; day += 1) {
    const weekday = day % 7
    if (weekday === 5 || weekday === 6) continue

    const saves = 4 + (day % 4)
    for (let save = 0; save < saves; save += 1) {
      const index = chronological.length
      const change = (day + save) % 9 === 0
        ? -(18 + (day % 3) * 12)
        : 24 + ((day * 11 + save * 17) % 72)
      charCount = Math.max(30, charCount + change)
      const timestamp = new Date(Date.UTC(2025, 0, 6 + day, 15 + save, (save * 11) % 60))
      chronological.push(makeEntry(
        `steady-${String(index + 1).padStart(3, '0')}`,
        charCount,
        timestamp.toISOString(),
        index === 0 ? 'baseline' : 'autosave'
      ))
    }
  }

  return chronological
    .map((entry, index) => ({
      ...entry,
      snapshot: makePreviewContent(Math.max(
        1,
        Math.ceil(((index + 1) / chronological.length) * 40)
      )),
    }))
    .reverse()
}

function makeBurstyProjectEntries(): AssignmentDocHistoryEntry[] {
  const chronological: AssignmentDocHistoryEntry[] = []
  const activeDays = [0, 3, 6, 10, 13]
  let charCount = 140

  activeDays.forEach((day, dayIndex) => {
    const saves = 9 + dayIndex * 2
    for (let save = 0; save < saves; save += 1) {
      const index = chronological.length
      const isRewrite = save === Math.floor(saves / 2) && dayIndex > 0
      const change = isRewrite
        ? -(220 + dayIndex * 85)
        : 38 + ((day * 19 + save * 31) % 150)
      charCount = Math.max(70, charCount + change)
      const timestamp = new Date(Date.UTC(2025, 2, 3 + day, 14, save * 4))
      chronological.push(makeEntry(
        `bursty-${String(index + 1).padStart(3, '0')}`,
        charCount,
        timestamp.toISOString(),
        index === 0 ? 'baseline' : 'autosave'
      ))
    }
  })

  return chronological.reverse()
}

function makeFinalDayCrunchEntries(): AssignmentDocHistoryEntry[] {
  const chronological = [makeEntry(
    'crunch-001',
    80,
    '2025-04-01T18:00:00.000Z',
    'baseline'
  )]
  let charCount = 80
  const startMs = Date.parse('2025-04-14T14:00:00.000Z')

  for (let save = 0; save < 100; save += 1) {
    const change = save % 11 === 0
      ? -(45 + (save % 4) * 35)
      : 12 + ((save * 23) % 86)
    charCount = Math.max(40, charCount + change)
    chronological.push(makeEntry(
      `crunch-${String(save + 2).padStart(3, '0')}`,
      charCount,
      new Date(startMs + save * 5 * 60 * 1000).toISOString()
    ))
  }

  return chronological.reverse()
}

const LONG_PROJECT_ENTRIES = makeSteadyProjectEntries()
const BURSTY_PROJECT_ENTRIES = makeBurstyProjectEntries()
const FINAL_DAY_CRUNCH_ENTRIES = makeFinalDayCrunchEntries()

// Newest-first (as from DB)
const SCENARIOS: { label: string; entries: AssignmentDocHistoryEntry[] }[] = [
  {
    label: 'Six-week project — steady work on most weekdays',
    entries: LONG_PROJECT_ENTRIES,
  },
  {
    label: 'Two-week project — bursts and large rewrites',
    entries: BURSTY_PROJECT_ENTRIES,
  },
  {
    label: 'Final-day crunch — 100 saves after a two-week gap',
    entries: FINAL_DAY_CRUNCH_ENTRIES,
  },
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
    <div id="history-graph" className="scroll-mt-28 bg-surface rounded-lg shadow-sm p-4">
      <h2 className="text-lg font-semibold text-text-default">History Graph</h2>
      <p className="text-text-muted text-sm mt-1">
        One compact chart shows additions and deletions across the actual activity
        days. It starts fitted to all activity; zoom in for individual saves.
        Hover to preview a save; click to pin it.
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
              {([
                [256, 'teacher'],
                [240, 'student'],
              ] as const).map(([w, audience]) => (
                <div
                  key={w}
                  className={`border border-border rounded ${audience === 'student' ? 'order-1 md:order-2' : 'order-2 md:order-1'}`}
                  style={{ width: w }}
                >
                  <div className="text-[10px] text-text-muted px-2 pt-1">
                      {audience} · {w}px
                  </div>
                  <HistoryGraph
                    entries={scenario.entries}
                    activeEntryId={activeId}
                    audience={audience}
                    showHeading={false}
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
