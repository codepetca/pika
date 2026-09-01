'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addMonths, addWeeks, format, subMonths, subWeeks } from 'date-fns'
import {
  ArrowLeft,
  CalendarDays,
  Archive,
  ArchiveRestore,
  ChevronDown,
  CircleDot,
  Eye,
  GripVertical,
  ListFilter,
  Mail,
  MoreVertical,
  Plus,
  RotateCw,
  Upload,
} from 'lucide-react'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { DateNavigator } from '@/components/DateNavigator'
import { LessonCalendar, type CalendarViewMode } from '@/components/LessonCalendar'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconMenuButton,
  TeacherWorkSurfaceMenuButton,
  type TeacherWorkSurfaceActionItem,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { Classroom, ClassDay, LessonPlan, TiptapContent } from '@/types'
import { SettingsMockup } from './SettingsMockup'
import { WorkSurfaceMockup } from './WorkSurfaceMockup'
import {
  Button,
  Card,
  ContentDialog,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyStateRow,
  FormField,
  IconButton,
  PageState,
  SegmentedControl,
  Select,
  SortableHeaderCell,
  TableSelectionCell,
  TableSelectionHeaderCell,
  Tabs,
  cn,
  type SortDirection,
} from '@/ui'

type PageId = 'classrooms' | 'gradebook' | 'calendar' | 'announcements' | 'roster' | 'settings' | 'workspaces'
type FixtureState = 'populated' | 'few-assessments' | 'loading' | 'empty' | 'error'
type ScoreMode = 'percent' | 'raw'
type AnnouncementFilter = 'all' | 'posted' | 'scheduled'

const PAGE_ITEMS = [
  { value: 'classrooms', label: 'Classrooms' },
  { value: 'gradebook', label: 'Gradebook' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'announcements', label: 'Announcements' },
  { value: 'roster', label: 'Roster' },
  { value: 'settings', label: 'Settings' },
  { value: 'workspaces', label: 'Workspaces' },
] as const

const GRADEBOOK_ASSESSMENTS = [
  'Ecosystems',
  'Cells',
  'Genetics',
  'Reactions',
  'Motion',
  'Climate',
  'Circuits',
  'Space',
  'Energy',
  'Waves',
  'Matter',
  'Sustainability',
] as const

const GRADEBOOK_SELECTION_COLUMN_WIDTH = 40
const GRADEBOOK_STUDENT_ID_COLUMN_WIDTH = 80
const GRADEBOOK_ASSESSMENT_COLUMN_WIDTH = 88
const GRADEBOOK_FINAL_COLUMN_WIDTH = 80

const STUDENTS = [
  { id: 'maya', studentId: '1004832', first: 'Maya', last: 'Chen', email: 'maya.chen@example.com', joined: true, scores: ['18/20', '42/50', '21/25', '34/40', '26/30', '17/20', '29/35', '22/25', '19/20', '27/30', '16/20', '23/25'], final: '86%' },
  { id: 'noah', studentId: '1004917', first: 'Noah', last: 'Williams-Montgomery', email: 'noah.williams@example.com', joined: true, scores: ['14/20', '38/50', '17/25', '31/40', '21/30', '15/20', '27/35', '18/25', '15/20', '22/30', '14/20', '19/25'], final: '77%' },
  { id: 'sana', studentId: '1004765', first: 'Sana', last: 'Patel', email: 'sana.patel@example.com', joined: false, scores: ['—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—'], final: '—' },
  { id: 'theo', studentId: '1004891', first: 'Theo', last: 'Martin', email: 'theo.martin@example.com', joined: true, scores: ['20/20', '46/50', '24/25', '38/40', '29/30', '19/20', '33/35', '24/25', '20/20', '29/30', '19/20', '25/25'], final: '94%' },
] as const

const ADDITIONAL_GRADEBOOK_STUDENTS = [
  ['avery', '1004952', 'Avery', 'Singh', 'avery.singh@example.com'],
  ['lucas', '1004688', 'Lucas', 'Tremblay', 'lucas.tremblay@example.com'],
  ['olivia', '1004974', 'Olivia', 'Garcia', 'olivia.garcia@example.com'],
  ['ethan', '1004721', 'Ethan', 'Brown', 'ethan.brown@example.com'],
  ['zoe', '1004860', 'Zoe', 'Wilson', 'zoe.wilson@example.com'],
  ['liam', '1004993', 'Liam', 'Jones', 'liam.jones@example.com'],
] as const

const POPULATED_GRADEBOOK_STUDENTS = [
  ...STUDENTS,
  ...ADDITIONAL_GRADEBOOK_STUDENTS.map(([id, studentId, first, last, email], index) => ({
    id,
    studentId,
    first,
    last,
    email,
    joined: true,
    scores: STUDENTS[index % STUDENTS.length].scores,
    final: STUDENTS[index % STUDENTS.length].final,
  })),
]

function summarizeGradebookValues(values: number[], kind: 'average' | 'median') {
  if (!values.length) return null
  if (kind === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function formatGradebookSummaryNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatGradebookAssessmentSummary(index: number, kind: 'average' | 'median', scoreMode: ScoreMode) {
  const scores = STUDENTS
    .map((student) => student.scores[index])
    .filter((score) => score !== '—')
    .map((score) => {
      const [earned, possible] = score.split('/').map(Number)
      return { earned, possible }
    })
  const earned = summarizeGradebookValues(scores.map((score) => score.earned), kind)
  const possible = scores[0]?.possible
  if (earned == null || possible == null) return '—'
  if (scoreMode === 'raw') return `${formatGradebookSummaryNumber(earned)}/${possible}`
  return `${formatGradebookSummaryNumber((earned / possible) * 100)}%`
}

function formatGradebookFinalSummary(kind: 'average' | 'median') {
  const value = summarizeGradebookValues(
    STUDENTS.map((student) => Number.parseFloat(student.final)).filter(Number.isFinite),
    kind,
  )
  return value == null ? '—' : `${formatGradebookSummaryNumber(value)}%`
}

const CLASSROOM_LIST = [
  { id: 'science', title: 'Grade 10 Science', term: 'Semester 1', dates: 'Sep 1, 2026 – Jan 29, 2027', accentClassName: 'bg-info' },
  { id: 'biology', title: 'Grade 11 Biology', term: 'Semester 1', dates: 'Sep 1, 2026 – Jan 29, 2027', accentClassName: 'bg-success' },
  { id: 'chemistry', title: 'Grade 12 Chemistry', term: 'Full year', dates: 'Sep 1, 2026 – Jun 25, 2027', accentClassName: 'bg-warning' },
] as const

const ARCHIVED_CLASSROOM_LIST = [
  { id: 'earth-space', title: 'Earth and Space Science', term: 'Semester 2', dates: 'Feb 2 – Jun 26, 2026', accentClassName: 'bg-info' },
  { id: 'general-science', title: 'General Science', term: 'Semester 1', dates: 'Sep 2, 2025 – Jan 30, 2026', accentClassName: 'bg-success' },
] as const

const DOC: TiptapContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review models of ecological succession and bring one question.' }] }] }
const CLASSROOM: Classroom = {
  id: 'pattern-classroom', teacher_id: 'pattern-teacher', title: 'Grade 10 Science', class_code: 'SCI2D',
  theme_color: 'blue', term_label: 'Semester 1', allow_enrollment: true, join_policy: 'roster',
  start_date: '2026-09-01', end_date: '2027-01-29', lesson_plan_visibility: 'all',
  feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY, blueprint_source_revision: 0,
  source_blueprint_id: null, source_blueprint_origin: null, actual_site_slug: null,
  actual_site_published: false, actual_site_config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  course_overview_markdown: '', course_outline_markdown: '', archived_at: null,
  created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z',
}
const LESSON_PLANS: LessonPlan[] = [
  { id: 'lp-1', classroom_id: CLASSROOM.id, date: '2026-09-14', content: DOC, content_markdown: 'Review models of ecological succession.', created_at: CLASSROOM.created_at, updated_at: CLASSROOM.updated_at },
  { id: 'lp-2', classroom_id: CLASSROOM.id, date: '2026-09-16', content: DOC, content_markdown: 'Field observation: compare two habitats.', created_at: CLASSROOM.created_at, updated_at: CLASSROOM.updated_at },
  { id: 'lp-3', classroom_id: CLASSROOM.id, date: '2027-01-22', content: DOC, content_markdown: 'Semester ecosystem reflection.', created_at: CLASSROOM.created_at, updated_at: CLASSROOM.updated_at },
]
const CLASS_DAYS: ClassDay[] = Array.from({ length: 18 }, (_, index) => ({
  id: `day-${index}`,
  classroom_id: CLASSROOM.id,
  date: `2026-09-${String(index + 8).padStart(2, '0')}`,
  prompt_text: null,
  is_class_day: index % 7 < 5,
}))

function Description({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-5 text-text-muted">{children}</p>
}

function MoreMenu({ label, items }: { label: string; items: TeacherWorkSurfaceActionItem[] }) {
  return (
    <TeacherWorkSurfaceIconMenuButton
      ariaLabel="More actions"
      menuAriaLabel={`${label} actions`}
      tooltip="More actions"
      icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
      items={items}
      menuPlacement="down"
      menuAlign="end"
      menuClassName="w-64"
    />
  )
}

function StateBoundary({ state, page, onRetry, children }: { state: FixtureState; page: string; onRetry: () => void; children: React.ReactNode }) {
  if (state === 'loading') return <PageState kind="loading" title={`Loading ${page}`} compact />
  if (state === 'empty') return <PageState kind="empty" title={`No ${page.toLowerCase()} records`} description="This is the successful empty state." compact />
  if (state === 'error') return <PageState kind="error" title={`${page} couldn't load`} description="Nothing was changed." action={<IconButton icon={RotateCw} label={`Try loading ${page.toLowerCase()} again`} variant="secondary" onClick={onRetry} />} compact />
  return <>{children}</>
}

export function PageMockups() {
  const [page, setPage] = useState<PageId>('classrooms')
  const [state, setState] = useState<FixtureState>('populated')
  const [prototypeMessage, setPrototypeMessage] = useState('Example controls never read or write live data.')
  const explain = (action: string) => setPrototypeMessage(`${action} selected. Example only—nothing was changed.`)

  return (
    <div className="space-y-4" data-testid="page-mockups">
      <Card tone="muted" padding="sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Experimental classroom page set</h3>
            <p className="mt-1 text-sm text-text-muted">Local fixtures only. Use the tabs and state selector to compare behavior before touching live pages.</p>
          </div>
          <FormField label="Example state" className="w-44">
            <Select id="page-mockup-state" value={state} onChange={(event) => setState(event.target.value as FixtureState)} options={[
              { value: 'populated', label: 'Populated' }, { value: 'few-assessments', label: 'Few assessments' }, { value: 'loading', label: 'Loading' },
              { value: 'empty', label: 'Empty' }, { value: 'error', label: 'Error' },
            ]} />
          </FormField>
        </div>
      </Card>
      <Tabs<PageId>
        ariaLabel="Classroom page mockups"
        value={page}
        onValueChange={setPage}
        items={PAGE_ITEMS}
        getTabId={(value) => `mockup-${value}-tab`}
        getPanelId={(value) => `mockup-${value}-panel`}
      />
      {PAGE_ITEMS.map((item) => (
        <section key={item.value} id={`mockup-${item.value}-panel`} role="tabpanel" aria-labelledby={`mockup-${item.value}-tab`} hidden={page !== item.value} className="scroll-mt-28 rounded-card border border-border bg-page p-2 sm:p-4">
          <StateBoundary state={item.value === 'gradebook' && state === 'empty' ? 'populated' : state} page={item.label} onRetry={() => setState('populated')}>
            {item.value === 'classrooms' ? <ClassroomsMockup isActive={page === 'classrooms'} onPrototypeAction={explain} /> : null}
            {item.value === 'gradebook' ? <GradebookMockup fixtureState={state} onPrototypeAction={explain} /> : null}
            {item.value === 'calendar' ? <CalendarMockup onPrototypeAction={explain} /> : null}
            {item.value === 'announcements' ? <AnnouncementsMockup onPrototypeAction={explain} /> : null}
            {item.value === 'roster' ? <RosterMockup onPrototypeAction={explain} /> : null}
            {item.value === 'settings' ? <SettingsMockup onPrototypeAction={explain} /> : null}
            {item.value === 'workspaces' ? <WorkSurfaceMockup onPrototypeAction={explain} /> : null}
          </StateBoundary>
        </section>
      ))}
      <p role="status" className="text-xs text-text-muted">{prototypeMessage}</p>
      <Description>
        Human review required before adoption. Page-specific statuses and operations stay local; this set proposes hierarchy and component reuse rather than one universal page template.
      </Description>
    </div>
  )
}

function ClassroomsMockup({
  isActive,
  onPrototypeAction,
}: {
  isActive: boolean
  onPrototypeAction: (action: string) => void
}) {
  const [view, setView] = useState<'active' | 'archived'>('active')
  const [isEditing, setIsEditing] = useState(false)
  const classroomsRef = useRef<HTMLDivElement>(null)
  const activeListHeadingRef = useRef<HTMLHeadingElement>(null)
  const classrooms = view === 'active' ? CLASSROOM_LIST : ARCHIVED_CLASSROOM_LIST
  const returnToActiveList = useCallback(() => {
    setView('active')
    setIsEditing(false)
    window.requestAnimationFrame(() => activeListHeadingRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!isActive) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (view === 'active' && !isEditing) return
      const activeElement = document.activeElement
      if (!activeElement || !classroomsRef.current?.contains(activeElement)) return
      returnToActiveList()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isActive, isEditing, returnToActiveList, view])

  const menuItems: TeacherWorkSurfaceActionItem[] = [
    {
      id: 'create',
      label: 'New Classroom',
      icon: <Plus className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onPrototypeAction('New Classroom'),
    },
    {
      id: 'edit',
      label: 'Edit classrooms',
      icon: <GripVertical className="h-4 w-4" aria-hidden="true" />,
      checked: isEditing,
      checkedRole: 'menuitemcheckbox',
      onSelect: () => {
        setView('active')
        setIsEditing((current) => !current)
      },
    },
    {
      id: 'toggle-archive-view',
      label: view === 'active' ? 'Show Archived' : 'Show Active',
      icon: view === 'active'
        ? <Archive className="h-4 w-4" aria-hidden="true" />
        : <CircleDot className="h-4 w-4" aria-hidden="true" />,
      dividerBefore: true,
      onSelect: () => {
        setView((current) => current === 'active' ? 'archived' : 'active')
        setIsEditing(false)
      },
    },
  ]

  return (
    <div ref={classroomsRef} className="relative min-h-96 pb-20" data-testid="classrooms-mockup">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          {isEditing || view === 'archived' ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="-ml-2 mb-1 px-2 text-text-muted"
              onClick={returnToActiveList}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to classrooms
            </Button>
          ) : null}
          <h4 ref={activeListHeadingRef} tabIndex={-1} className="font-semibold text-text-default focus:outline-none">
            {view === 'active' ? 'Active classrooms' : 'Archived classrooms'}
          </h4>
          <p className="mt-0.5 text-xs text-text-muted">
            {isEditing && view === 'active'
              ? 'Drag to reorder or archive a classroom.'
              : view === 'archived'
                ? 'Open or restore a previous classroom.'
                : `${classrooms.length} classrooms`}
          </p>
        </div>
        {isEditing ? <span className="text-xs font-medium text-primary">Editing</span> : null}
      </div>

      <div className="space-y-2">
        {classrooms.map((classroom) => (
          <Card key={classroom.id} tone="panel" padding="none" interactive>
            <div className="flex min-h-20 items-center gap-2 px-3 py-3 sm:gap-4 sm:px-4">
              <div className="flex min-w-8 justify-center">
                {isEditing && view === 'active' ? (
                  <IconButton
                    icon={GripVertical}
                    label={`Drag to reorder ${classroom.title}`}
                    variant="ghost"
                    onClick={() => onPrototypeAction(`Reorder ${classroom.title}`)}
                  />
                ) : (
                  <span className={cn('h-8 w-1.5 rounded-full', classroom.accentClassName)} aria-hidden="true" />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-h-control min-w-0 flex-1 justify-start px-1 text-left"
                onClick={() => onPrototypeAction(`Open ${classroom.title}`)}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="truncate font-semibold text-text-default">{classroom.title}</span>
                    <span className="text-sm font-normal text-text-muted">{classroom.term}</span>
                  </span>
                  <span className="mt-1 block text-sm font-normal text-text-muted">{classroom.dates}</span>
                </span>
              </Button>
              <div className="flex min-w-11 justify-end">
                {isEditing && view === 'active' ? (
                  <IconButton
                    icon={Archive}
                    label={`Archive ${classroom.title}`}
                    variant="ghost"
                    onClick={() => onPrototypeAction(`Archive ${classroom.title}`)}
                  />
                ) : view === 'archived' ? (
                  <IconButton
                    icon={ArchiveRestore}
                    label={`Unarchive ${classroom.title}`}
                    variant="ghost"
                    onClick={() => onPrototypeAction(`Unarchive ${classroom.title}`)}
                  />
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-2 flex justify-end px-2 sm:px-4">
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="Classroom actions"
          menuAriaLabel="Classroom actions"
          tooltip="Classroom actions"
          icon={<MoreVertical className="h-5 w-5" aria-hidden="true" />}
          items={menuItems}
          variant="ghost"
          menuPlacement="up"
          menuAlign="end"
          menuClassName="w-64"
        />
      </div>

      <Description>
        The borderless bottom three-dot menu owns New Classroom, edit mode, and the Show Archived/Show Active toggle. Back to classrooms and Escape both return to the main Active list and clear edit mode.
      </Description>
    </div>
  )
}

function GradebookMockup({ fixtureState, onPrototypeAction }: { fixtureState: FixtureState; onPrototypeAction: (action: string) => void }) {
  const [scoreMode, setScoreMode] = useState<ScoreMode>('percent')
  const [summaryKind, setSummaryKind] = useState<'average' | 'median'>('average')
  const [nameOrder, setNameOrder] = useState<'first-last' | 'last-first'>('first-last')
  const [showStudentIds, setShowStudentIds] = useState(false)
  const [keepKeyColumnsVisible, setKeepKeyColumnsVisible] = useState(true)
  const [firstColumnWidth, setFirstColumnWidth] = useState(96)
  const [lastColumnWidth, setLastColumnWidth] = useState(96)
  const [selected, setSelected] = useState<string[]>([])
  const empty = fixtureState === 'empty'
  const fewAssessments = fixtureState === 'few-assessments'
  const assessments = empty ? [] : fewAssessments ? GRADEBOOK_ASSESSMENTS.slice(0, 3) : GRADEBOOK_ASSESSMENTS
  const [sort, setSort] = useState<{ key: 'first' | 'last'; direction: SortDirection }>({ key: 'last', direction: 'asc' })
  const gradebookStudents = empty || fewAssessments ? STUDENTS : POPULATED_GRADEBOOK_STUDENTS
  const rows = useMemo(() => [...gradebookStudents].sort((a, b) => {
    const order = a[sort.key].localeCompare(b[sort.key])
    return sort.direction === 'asc' ? order : -order
  }), [gradebookStudents, sort])
  const toggleSort = (key: 'first' | 'last') => setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const formatScore = (score: string) => {
    if (scoreMode === 'raw' || score === '—') return score
    const [earned, possible] = score.split('/').map(Number)
    return `${Math.round((earned / possible) * 100)}%`
  }
  const fixedTableWidth = GRADEBOOK_SELECTION_COLUMN_WIDTH
    + firstColumnWidth
    + lastColumnWidth
    + (showStudentIds ? GRADEBOOK_STUDENT_ID_COLUMN_WIDTH : 0)
    + GRADEBOOK_FINAL_COLUMN_WIDTH
  const flexibleTableMinWidth = fixedTableWidth + assessments.length * GRADEBOOK_ASSESSMENT_COLUMN_WIDTH + 96
  const populatedTableWidth = fixedTableWidth + assessments.length * GRADEBOOK_ASSESSMENT_COLUMN_WIDTH
  const nameColumns = nameOrder === 'first-last'
    ? [
        { key: 'first' as const, label: 'First', width: firstColumnWidth, onWidthChange: setFirstColumnWidth },
        { key: 'last' as const, label: 'Last', width: lastColumnWidth, onWidthChange: setLastColumnWidth },
      ]
    : [
        { key: 'last' as const, label: 'Last', width: lastColumnWidth, onWidthChange: setLastColumnWidth },
        { key: 'first' as const, label: 'First', width: firstColumnWidth, onWidthChange: setFirstColumnWidth },
      ]

  return (
    <div className="space-y-3">
      <TeacherWorkSurfaceContextBar
        ariaLabel="Gradebook mockup controls"
        primary={<TeacherWorkSurfaceActionCluster>
          <TeacherWorkSurfaceMenuButton
            label={<span className="inline-flex items-center gap-2 whitespace-nowrap">
              <span>{selected.length ? `${selected.length} selected` : 'Student Actions'}</span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </span>}
            items={[{
              id: 'email',
              label: 'Email selected students',
              icon: <Mail className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => onPrototypeAction('Email students'),
            }]}
            disabled={!selected.length}
            variant={selected.length ? 'primary' : 'secondary'}
            menuAriaLabel="Student actions"
            menuAlign="start"
          />
        </TeacherWorkSurfaceActionCluster>}
        actions={<MoreMenu label="Gradebook" items={[
          { id: 'score-mode', label: scoreMode === 'percent' ? 'Show raw scores' : 'Show %', onSelect: () => setScoreMode((current) => current === 'percent' ? 'raw' : 'percent') },
          { id: 'summary-kind', label: summaryKind === 'average' ? 'Show median' : 'Show average', onSelect: () => setSummaryKind((current) => current === 'average' ? 'median' : 'average') },
          { id: 'name-order', label: nameOrder === 'first-last' ? 'Show last name first' : 'Show first name first', onSelect: () => setNameOrder((current) => current === 'first-last' ? 'last-first' : 'first-last') },
          { id: 'student-ids', label: 'Show student IDs', checked: showStudentIds, onSelect: () => setShowStudentIds((current) => !current) },
          { id: 'sticky-columns', label: 'Keep key columns visible', checked: keepKeyColumnsVisible, onSelect: () => setKeepKeyColumnsVisible((current) => !current) },
          { id: 'export', label: 'Export gradebook', onSelect: () => onPrototypeAction('Export gradebook') },
        ]} />}
      />
      <TeacherWorkSurfaceTableFrame
        data-testid="gradebook-scroll-frame"
        className={cn(empty || fewAssessments ? 'max-h-80 border border-border' : 'h-80 border border-border')}
      >
        <div
          className={cn((empty || fewAssessments) && 'w-full')}
          style={empty || fewAssessments
            ? { minWidth: `${flexibleTableMinWidth}px` }
            : { width: `${populatedTableWidth}px` }}
        >
          <DataTable density="tight" className="table-fixed">
            <colgroup>
              <col style={{ width: GRADEBOOK_SELECTION_COLUMN_WIDTH }} />
              {nameColumns.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}
              {showStudentIds ? <col style={{ width: GRADEBOOK_STUDENT_ID_COLUMN_WIDTH }} /> : null}
              {empty ? <col /> : assessments.map((assessment) => <col key={assessment} style={{ width: GRADEBOOK_ASSESSMENT_COLUMN_WIDTH }} />)}
              {fewAssessments ? <col /> : null}
              <col style={{ width: GRADEBOOK_FINAL_COLUMN_WIDTH }} />
            </colgroup>
            <DataTableHead sticky><DataTableRow>
              <TableSelectionHeaderCell className={keepKeyColumnsVisible ? 'sticky left-0 top-0 z-sticky-table bg-surface-2' : ''} checked={selected.length === rows.length} indeterminate={selected.length > 0 && selected.length < rows.length} onChange={(checked) => setSelected(checked ? rows.map((row) => row.id) : [])} ariaLabel="Select all gradebook students" />
              {nameColumns.map((column, index) => (
                <SortableHeaderCell
                  key={column.key}
                  className={keepKeyColumnsVisible && index === 0 ? 'sticky left-10 top-0 z-sticky-table border-r border-border-strong bg-surface-2' : ''}
                  label={column.label}
                  isActive={sort.key === column.key}
                  direction={sort.direction}
                  onClick={() => toggleSort(column.key)}
                  resize={{ value: column.width, min: 72, max: 220, onChange: column.onWidthChange }}
                />
              ))}
              {showStudentIds ? <DataTableHeaderCell>ID</DataTableHeaderCell> : null}
              {empty ? <DataTableHeaderCell align="center">Assessments</DataTableHeaderCell> : assessments.map((assessment) => <DataTableHeaderCell key={assessment} align="center" title={assessment} className="overflow-hidden whitespace-nowrap"><span className="block truncate">{assessment}</span></DataTableHeaderCell>)}
              {fewAssessments ? <DataTableHeaderCell><span className="sr-only">Unused assessment space</span></DataTableHeaderCell> : null}
              <DataTableHeaderCell align="right" className={cn('whitespace-nowrap', keepKeyColumnsVisible && 'sticky right-0 top-0 z-sticky-table border-l border-border-strong bg-surface-2')}>Final</DataTableHeaderCell>
            </DataTableRow></DataTableHead>
            <DataTableBody>{rows.map((student) => {
              const isSelected = selected.includes(student.id)
              const stickyCellSurface = keepKeyColumnsVisible
                ? isSelected ? 'bg-info-bg' : 'bg-surface group-hover:bg-surface-hover'
                : ''
              return <DataTableRow key={student.id} className={cn('group', isSelected ? 'bg-info-bg' : 'hover:bg-surface-hover')}>
                <TableSelectionCell className={cn(keepKeyColumnsVisible && 'sticky left-0', stickyCellSurface)} checked={isSelected} onChange={() => toggle(student.id)} ariaLabel={`Select ${student.first} ${student.last}`} />
                {nameColumns.map((column, index) => (
                  <DataTableCell
                    key={column.key}
                    className={cn(
                      'truncate whitespace-nowrap',
                      keepKeyColumnsVisible && index === 0 && 'sticky left-10 border-r border-border-strong',
                      keepKeyColumnsVisible && index === 0 && stickyCellSurface,
                    )}
                    title={student[column.key]}
                  >
                    {student[column.key]}
                  </DataTableCell>
                ))}
                {showStudentIds ? <DataTableCell>{student.studentId}</DataTableCell> : null}
                {empty ? <DataTableCell aria-label="No assessments">{null}</DataTableCell> : assessments.map((assessment, index) => <DataTableCell key={assessment} align="center" className="whitespace-nowrap">{formatScore(student.scores[index])}</DataTableCell>)}
                {fewAssessments ? <DataTableCell aria-hidden="true">{null}</DataTableCell> : null}
                <DataTableCell align="right" className={cn('whitespace-nowrap font-semibold', keepKeyColumnsVisible && 'sticky right-0 border-l border-border-strong', stickyCellSurface)}>{empty ? '—' : student.final}</DataTableCell>
              </DataTableRow>
            })}</DataTableBody>
            {!empty ? (
              <tfoot
                data-testid="gradebook-summary-footer"
                className="sticky bottom-0 z-sticky-table bg-surface-2"
              >
                <DataTableRow
                  aria-label={summaryKind === 'average' ? 'Class average' : 'Class median'}
                  className="border-y border-border-strong bg-surface-2"
                >
                  <DataTableCell
                    className={cn(
                      '!px-1 text-center text-xs font-semibold uppercase tracking-wide text-text-muted',
                      keepKeyColumnsVisible && 'sticky left-0 z-sticky-table border-r border-border-strong bg-surface-2',
                    )}
                  >
                    {summaryKind === 'average' ? 'Avg' : 'Med'}
                  </DataTableCell>
                  {nameColumns.map((column, index) => (
                    <DataTableCell
                      key={column.key}
                      className={cn(keepKeyColumnsVisible && index === 0 && 'sticky left-10 z-sticky-table border-r border-border-strong bg-surface-2')}
                    >
                      {null}
                    </DataTableCell>
                  ))}
                  {showStudentIds ? <DataTableCell>{null}</DataTableCell> : null}
                  {assessments.map((assessment, index) => (
                    <DataTableCell key={`${summaryKind}:${assessment}`} align="center" className="whitespace-nowrap text-xs tabular-nums">
                      {formatGradebookAssessmentSummary(index, summaryKind, scoreMode)}
                    </DataTableCell>
                  ))}
                  {fewAssessments ? <DataTableCell aria-hidden="true">{null}</DataTableCell> : null}
                  <DataTableCell
                    align="right"
                    className={cn(
                      'whitespace-nowrap font-semibold tabular-nums',
                      keepKeyColumnsVisible && 'sticky right-0 z-sticky-table border-l border-border-strong bg-surface-2',
                    )}
                  >
                    {formatGradebookFinalSummary(summaryKind)}
                  </DataTableCell>
                </DataTableRow>
              </tfoot>
            ) : null}
          </DataTable>
        </div>
      </TeacherWorkSurfaceTableFrame>
      <Description>{empty
        ? 'With no assessments, the roster remains visible and the Assessments column spans the remaining table width.'
        : fewAssessments
          ? 'With only a few assessments, each assessment keeps its compact minimum width while the empty assessment area expands and keeps Final at the far edge.'
          : 'Compact assessment columns show the dense horizontal gradebook. The selected class summary stays pinned to the bottom edge while roster rows scroll underneath; More actions swaps Average and Median or puts Last name first.'}</Description>
    </div>
  )
}

function CalendarMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const [view, setView] = useState<CalendarViewMode>('week')
  const [date, setDate] = useState(new Date('2026-09-14T12:00:00'))
  const advance = (amount: -1 | 1) => setDate((current) => view === 'month' ? (amount < 0 ? subMonths(current, 1) : addMonths(current, 1)) : (amount < 0 ? subWeeks(current, 1) : addWeeks(current, 1)))
  const label = view === 'week' ? `Week of ${format(date, 'MMM d')}` : view === 'month' ? format(date, 'MMMM yyyy') : CLASSROOM.term_label || 'Term'
  const viewItems: TeacherWorkSurfaceActionItem[] = (['week', 'month', 'all'] as const).map((mode) => ({ id: mode, label: mode === 'all' ? 'Term' : mode[0].toUpperCase() + mode.slice(1), checked: view === mode, checkedRole: 'menuitemradio', onSelect: () => setView(mode) }))
  viewItems.push({ id: 'markdown', label: 'Edit calendar in Markdown', dividerBefore: true, onSelect: () => onPrototypeAction('Edit calendar in Markdown') })
  return <div className="space-y-3">
    <TeacherWorkSurfaceContextBar
      ariaLabel="Calendar mockup controls"
      context={<span className="hidden truncate sm:inline">Teaching calendar</span>}
      primary={<DateNavigator joined label={label} showNavigation={view !== 'all'} onPrev={() => advance(-1)} onNext={() => advance(1)} onLabelClick={view === 'all' ? undefined : () => setDate(new Date('2026-09-14T12:00:00'))} labelAriaLabel={view === 'week' ? 'Return to reference week' : 'Return to reference month'} />}
      actions={<MoreMenu label="Calendar" items={viewItems} />}
    />
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <LessonCalendar classroom={CLASSROOM} lessonPlans={LESSON_PLANS} classDays={CLASS_DAYS} viewMode={view} currentDate={date} editable={false} showHeader={false} onDateChange={setDate} onViewModeChange={setView} />
    </div>
    <Description>The date owns the center. Week, Month, Term, and Markdown editing move to More actions so the bar does not wrap into competing controls.</Description>
  </div>
}

const ANNOUNCEMENTS = [
  { id: 'trip', title: 'Field study reminder', body: 'Bring a reusable water bottle and arrive by **8:20 AM**.', date: 'Posted Aug 28', state: 'posted' as const },
  { id: 'lab', title: 'Lab groups', body: 'Your lab groups will be posted before class.', date: 'Scheduled Sep 15 · 7:00 AM', state: 'scheduled' as const },
]

function AnnouncementsMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const [filter, setFilter] = useState<AnnouncementFilter>('all')
  const [preview, setPreview] = useState<typeof ANNOUNCEMENTS[number] | null>(null)
  const visible = ANNOUNCEMENTS.filter((item) => filter === 'all' || item.state === filter)
  return <div className="space-y-3">
    <TeacherWorkSurfaceContextBar
      ariaLabel="Announcement mockup controls"
      context={<span className="hidden truncate sm:inline">{visible.length} announcements</span>}
      primary={<TeacherWorkSurfaceActionCluster><IconButton icon={Plus} label="Create announcement" variant="primary" onClick={() => onPrototypeAction('Create announcement')} /></TeacherWorkSurfaceActionCluster>}
      actions={<MoreMenu label="Announcement" items={(['all', 'posted', 'scheduled'] as const).map((value, index) => ({ id: value, label: value[0].toUpperCase() + value.slice(1), icon: index === 0 ? <ListFilter className="h-4 w-4" aria-hidden="true" /> : undefined, checked: filter === value, checkedRole: 'menuitemradio', onSelect: () => setFilter(value) }))} />}
    />
    <div className="space-y-3">{visible.length ? visible.map((item) => <Card key={item.id} tone="panel" padding="md">
      <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{item.title}</h4><p className="mt-0.5 text-xs text-text-muted">{item.date}</p></div><IconButton icon={Eye} label={`Preview ${item.title}`} variant="ghost" onClick={() => setPreview(item)} /></div>
      <AnnouncementContent content={item.body} className="mt-3" />
    </Card>) : <PageState kind="empty" title="No matching announcements" compact />}</div>
    <ContentDialog isOpen={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.title ?? 'Announcement'} subtitle={preview?.date} showFooterClose={false}>{preview ? <AnnouncementContent content={preview.body} /> : null}</ContentDialog>
    <Description>Announcements remain a reading list rather than becoming an operational table. The center uses +; the right menu filters Posted/Scheduled items.</Description>
  </div>
}

function RosterMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: 'first' | 'last'; direction: SortDirection }>({ key: 'last', direction: 'asc' })
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const rows = useMemo(() => [...STUDENTS].sort((a, b) => (sort.direction === 'asc' ? 1 : -1) * a[sort.key].localeCompare(b[sort.key])), [sort])
  const changeSort = (key: 'first' | 'last') => setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  return <div className="space-y-3">
    <TeacherWorkSurfaceContextBar
      ariaLabel="Roster mockup controls"
      context={<span className="hidden truncate sm:inline">3 joined · 1 invited</span>}
      primary={<TeacherWorkSurfaceActionCluster>
        <IconButton icon={Plus} label="Add students" variant="primary" onClick={() => onPrototypeAction('Add students')} />
        <TeacherWorkSurfaceMenuButton label={<span className="inline-flex items-center gap-1"><Mail className="h-4 w-4" aria-hidden="true" />{selected.length}</span>} items={[{ id: 'email', label: `Email ${selected.length} selected`, onSelect: () => onPrototypeAction('Email students') }, { id: 'remove', label: `Remove ${selected.length} from roster`, destructive: true, onSelect: () => onPrototypeAction('Remove students') }]} disabled={!selected.length} variant={selected.length ? 'primary' : 'secondary'} buttonProps={{ 'aria-label': selected.length ? `Selected students (${selected.length})` : 'Selected students (0)' }} />
      </TeacherWorkSurfaceActionCluster>}
      actions={<MoreMenu label="Roster" items={[{ id: 'csv', label: 'Import CSV', icon: <Upload className="h-4 w-4" aria-hidden="true" />, onSelect: () => onPrototypeAction('Import CSV') }, { id: 'copy', label: 'Copy all emails', onSelect: () => onPrototypeAction('Copy all emails') }]} />}
    />
    <TeacherWorkSurfaceTableFrame className="max-h-80 border border-border"><DataTable density="tight">
      <DataTableHead sticky><DataTableRow><TableSelectionHeaderCell checked={selected.length === rows.length} indeterminate={selected.length > 0 && selected.length < rows.length} onChange={(checked) => setSelected(checked ? rows.map((row) => row.id) : [])} ariaLabel="Select all roster students" /><SortableHeaderCell label="First" isActive={sort.key === 'first'} direction={sort.direction} onClick={() => changeSort('first')} /><SortableHeaderCell label="Last" isActive={sort.key === 'last'} direction={sort.direction} onClick={() => changeSort('last')} /><DataTableHeaderCell className="hidden sm:table-cell">Email</DataTableHeaderCell><DataTableHeaderCell>Joined</DataTableHeaderCell></DataTableRow></DataTableHead>
      <DataTableBody>{rows.length ? rows.map((student) => <DataTableRow key={student.id} className={selected.includes(student.id) ? 'bg-info-bg' : 'hover:bg-surface-hover'}><TableSelectionCell checked={selected.includes(student.id)} onChange={() => toggle(student.id)} ariaLabel={`Select ${student.first} ${student.last}`} /><DataTableCell>{student.first}</DataTableCell><DataTableCell>{student.last}</DataTableCell><DataTableCell className="hidden sm:table-cell text-text-muted">{student.email}</DataTableCell><DataTableCell><span className={cn('font-medium', student.joined ? 'text-success' : 'text-text-muted')}>{student.joined ? 'Yes' : 'Invited'}</span></DataTableCell></DataTableRow>) : <EmptyStateRow colSpan={5} message="No students yet" />}</DataTableBody>
    </DataTable></TeacherWorkSurfaceTableFrame>
    <Description>Add Students stays an icon-only primary action. Selected email/removal actions remain disabled in place until selection; CSV import stays at the right.</Description>
  </div>
}
