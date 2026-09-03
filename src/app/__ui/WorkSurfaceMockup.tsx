'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Code, Eye, MoreVertical, Plus, Users } from 'lucide-react'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import { TeacherWorkItemList } from '@/components/teacher-work-surface/TeacherWorkItemList'
import {
  TeacherWorkSurfaceActionCluster,
  TeacherWorkSurfaceIconMenuButton,
  TeacherWorkSurfaceMenuButton,
} from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceModeBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceModeBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { TeacherWorkSurfaceTableFrame } from '@/components/teacher-work-surface/TeacherWorkSurfaceTableFrame'
import { TeacherWorkspaceSplit } from '@/components/teacher-work-surface/TeacherWorkspaceSplit'
import {
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  IconButton,
  SegmentedControl,
  TableSelectionCell,
  TableSelectionHeaderCell,
  cn,
} from '@/ui'

type WorkFamily = 'classwork' | 'tests'
type WorkspaceMode = 'overview' | 'students'

const FAMILY_OPTIONS: Array<{ value: WorkFamily; label: string }> = [
  { value: 'classwork', label: 'Classwork' },
  { value: 'tests', label: 'Tests' },
]

const WORK_ITEMS = {
  classwork: [
    { id: 'field-observations', title: 'Field observations', kind: 'Assignment', status: 'Posted', detail: 'Due Sep 18 · 4 students' },
    { id: 'ecosystem-reading', title: 'Ecosystem reading', kind: 'Material', status: 'Posted', detail: 'Posted Sep 11' },
    { id: 'field-trip-check', title: 'Field trip check-in', kind: 'Survey', status: 'Draft', detail: '3 questions' },
  ],
  tests: [
    { id: 'ecosystems-test', title: 'Ecosystems test', kind: 'Test', status: 'Open', detail: '20 points · 3 submissions' },
    { id: 'cells-check', title: 'Cells checkpoint', kind: 'Test', status: 'Draft', detail: '10 points · 8 questions' },
  ],
} as const

const STUDENTS = [
  { id: 'maya', name: 'Maya Chen', status: 'Submitted', score: '18 / 20' },
  { id: 'noah', name: 'Noah Williams', status: 'In progress', score: '—' },
  { id: 'sana', name: 'Sana Patel', status: 'Not started', score: '—' },
]

export function WorkSurfaceMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const [family, setFamily] = useState<WorkFamily>('classwork')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [mode, setMode] = useState<WorkspaceMode>('overview')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [inspectorStudentId, setInspectorStudentId] = useState<string | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(40)
  const items = WORK_ITEMS[family]
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId])
  const inspectorStudent = STUDENTS.find((student) => student.id === inspectorStudentId) ?? null

  function changeFamily(next: WorkFamily) {
    setFamily(next)
    setSelectedItemId(null)
    setMode('overview')
    setSelectedStudentIds([])
    setInspectorStudentId(null)
  }

  function openItem(id: string) {
    setSelectedItemId(id)
    setMode('overview')
    setSelectedStudentIds([])
    setInspectorStudentId(null)
  }

  function returnToSummary() {
    setSelectedItemId(null)
    setSelectedStudentIds([])
    setInspectorStudentId(null)
  }

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId])
  }

  const summaryBar = (
    <TeacherWorkSurfaceContextBar
      ariaLabel={`${family === 'classwork' ? 'Classwork' : 'Test'} summary actions`}
      context={<span className="hidden sm:inline">{items.length} items</span>}
      primary={(
        <TeacherWorkSurfaceActionCluster>
          <IconButton icon={Plus} label={family === 'classwork' ? 'Create classwork' : 'Create test'} variant="primary" onClick={() => onPrototypeAction(family === 'classwork' ? 'Create classwork' : 'Create test')} />
        </TeacherWorkSurfaceActionCluster>
      )}
      actions={(
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="More actions"
          tooltip="More actions"
          icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
          menuAriaLabel={`${family} actions`}
          menuAlign="end"
          menuPlacement="down"
          items={[
            { id: 'markdown', label: `Edit all ${family} in Markdown`, icon: <Code className="h-4 w-4" aria-hidden="true" />, onSelect: () => onPrototypeAction(`Edit all ${family} in Markdown`) },
            {
              id: 'organize',
              label: family === 'classwork' ? 'Organize classwork' : 'Edit Tests',
              onSelect: () => onPrototypeAction(family === 'classwork' ? 'Organize classwork' : 'Edit Tests'),
            },
          ]}
        />
      )}
    />
  )

  const workspaceBar = selectedItem ? (
    <TeacherWorkSurfaceContextBar
      ariaLabel={`${selectedItem.kind} workspace actions`}
      context={(
        <div className="flex items-center gap-1">
          <IconButton icon={ArrowLeft} label="Back to item list" variant="ghost" onClick={returnToSummary} />
          <span className="hidden max-w-32 truncate xl:inline">{selectedItem.title}</span>
        </div>
      )}
      contextClassName="overflow-visible"
      primary={(
        <TeacherWorkSurfaceModeBar<WorkspaceMode>
          ariaLabel="Selected work modes"
          modes={[{ id: 'overview', label: 'Overview' }, { id: 'students', label: 'Students' }]}
          activeMode={mode}
          onModeChange={(next) => {
            setMode(next)
            if (next !== 'students') setInspectorStudentId(null)
          }}
          getTabId={(value) => `work-pattern-${value}-tab`}
          getPanelId={(value) => `work-pattern-${value}-panel`}
          trailing={mode === 'students' ? (
            <TeacherWorkSurfaceMenuButton
              label={<span className="inline-flex items-center gap-1"><Users className="h-4 w-4" aria-hidden="true" />{selectedStudentIds.length}</span>}
              items={[
                { id: 'return', label: `Return ${selectedStudentIds.length} selected`, onSelect: () => onPrototypeAction('Return selected work') },
                { id: 'email', label: `Email ${selectedStudentIds.length} selected`, onSelect: () => onPrototypeAction('Email selected students') },
              ]}
              disabled={selectedStudentIds.length === 0}
              variant={selectedStudentIds.length ? 'primary' : 'secondary'}
              buttonProps={{ 'aria-label': `Selected students (${selectedStudentIds.length})` }}
              menuAlign="center"
              menuPlacement="down"
            />
          ) : undefined}
        />
      )}
      actions={(
        <TeacherWorkSurfaceIconMenuButton
          ariaLabel="More actions"
          tooltip="More actions"
          icon={<MoreVertical className="h-4 w-4" aria-hidden="true" />}
          menuAriaLabel={`${selectedItem.title} actions`}
          menuAlign="end"
          menuPlacement="down"
          items={[
            { id: 'preview', label: `Preview ${selectedItem.kind.toLowerCase()}`, icon: <Eye className="h-4 w-4" aria-hidden="true" />, onSelect: () => onPrototypeAction(`Preview ${selectedItem.title}`) },
            { id: 'markdown', label: 'Edit in Markdown', icon: <Code className="h-4 w-4" aria-hidden="true" />, onSelect: () => onPrototypeAction(`Edit ${selectedItem.title} in Markdown`) },
          ]}
        />
      )}
    />
  ) : summaryBar

  const summary = (
    <TeacherWorkItemList>
      {items.map((item) => (
        <TeacherWorkItemCardFrame key={item.id} interactive={false} tone={item.id === selectedItemId ? 'selected' : item.status === 'Draft' ? 'muted' : 'default'}>
          <div className="flex items-start justify-between gap-3">
            <Button type="button" variant="ghost" className="min-w-0 flex-1 justify-start px-0 py-0 text-left text-text-default hover:bg-transparent" onClick={() => openItem(item.id)}>
              <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text-default">{item.title}</span>
                <span className={cn('text-xs font-medium', item.status === 'Draft' ? 'text-text-muted' : 'text-success')}>{item.status}</span>
              </span>
              <span className="mt-1 block text-xs text-text-muted">{item.kind} · {item.detail}</span>
              </span>
            </Button>
            <IconButton icon={Eye} label={`Preview ${item.title}`} variant="ghost" onClick={() => onPrototypeAction(`Preview ${item.title}`)} />
          </div>
        </TeacherWorkItemCardFrame>
      ))}
    </TeacherWorkItemList>
  )

  const overviewPanel = selectedItem ? (
    <div id="work-pattern-overview-panel" role="tabpanel" aria-labelledby="work-pattern-overview-tab" hidden={mode !== 'overview'} className="h-full overflow-y-auto p-4 sm:p-5">
      <Card tone="panel" padding="md" className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{selectedItem.kind}</p>
            <h4 className="mt-1 text-lg font-semibold">{selectedItem.title}</h4>
            <p className="mt-1 text-sm text-text-muted">{selectedItem.detail}</p>
          </div>
          <span className="text-sm font-medium text-success">{selectedItem.status}</span>
        </div>
        <p className="mt-5 text-sm leading-6 text-text-default">Review the selected item before moving into student work. Authoring, preview, Markdown, and lifecycle actions stay contextual to this workspace.</p>
      </Card>
    </div>
  ) : null

  const inspector = inspectorStudent ? (
    <Card tone="panel" padding="md" className="h-full overflow-y-auto shadow-none">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Student work</p>
      <h4 className="mt-1 font-semibold">{inspectorStudent.name}</h4>
      <p className="mt-1 text-sm text-text-muted">{inspectorStudent.status} · {inspectorStudent.score}</p>
      <div className="mt-4 rounded-control border border-border bg-surface-2 p-3 text-sm leading-6">Selected response or document appears here only after the teacher chooses a student.</div>
    </Card>
  ) : undefined

  const studentsPanel = selectedItem ? (
    <div id="work-pattern-students-panel" role="tabpanel" aria-labelledby="work-pattern-students-tab" hidden={mode !== 'students'} className="h-full min-h-0 flex-1 flex-col">
      <TeacherWorkspaceSplit
        className="min-h-0 flex-1"
        splitVariant="gapped"
        inspectorWidth={inspectorWidth}
        onInspectorWidthChange={setInspectorWidth}
        inspectorCollapsed={!inspectorStudent}
        inspector={inspector}
        dividerLabel="Resize student list and work preview"
        minPrimaryPx={320}
        minInspectorPx={280}
        primaryClassName="flex min-h-0 flex-col rounded-lg border border-border bg-surface"
        inspectorClassName="min-h-0 rounded-lg border border-border bg-surface"
        primary={(
          <TeacherWorkSurfaceTableFrame className="min-h-0 rounded-lg">
            <DataTable density="tight">
              <DataTableHead sticky>
                <DataTableRow>
                  <TableSelectionHeaderCell
                    checked={selectedStudentIds.length === STUDENTS.length}
                    indeterminate={selectedStudentIds.length > 0 && selectedStudentIds.length < STUDENTS.length}
                    onChange={(checked) => setSelectedStudentIds(checked ? STUDENTS.map((student) => student.id) : [])}
                    ariaLabel="Select all example students"
                  />
                  <DataTableHeaderCell>Student</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Score</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {STUDENTS.map((student) => (
                  <DataTableRow key={student.id} className={inspectorStudentId === student.id ? 'bg-info-bg' : 'hover:bg-surface-hover'}>
                    <TableSelectionCell checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} ariaLabel={`Select ${student.name}`} />
                    <DataTableCell>
                      <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start px-0 text-left font-medium text-primary underline-offset-2 hover:bg-transparent hover:text-primary hover:underline" onClick={() => setInspectorStudentId(student.id)}>{student.name}</Button>
                    </DataTableCell>
                    <DataTableCell>{student.status}</DataTableCell>
                    <DataTableCell>{student.score}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </TeacherWorkSurfaceTableFrame>
        )}
      />
    </div>
  ) : null

  return (
    <div className="space-y-3" data-testid="work-surface-mockup">
      <Card tone="muted" padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Shared work progression</h3>
            <p className="mt-0.5 text-xs text-text-muted">Compare the same summary → workspace → student inspector structure.</p>
          </div>
          <SegmentedControl ariaLabel="Workspace family" value={family} onChange={changeFamily} options={FAMILY_OPTIONS} />
        </div>
      </Card>
      <div className="min-h-96 overflow-hidden rounded-card border border-border bg-page" data-testid="work-surface-shell-example">
        <TeacherWorkSurfaceShell
          className="mx-0"
          state={selectedItem ? 'workspace' : 'summary'}
          primary={workspaceBar}
          summary={summary}
          workspace={selectedItem ? <>{overviewPanel}{studentsPanel}</> : null}
          workspaceFrame="standalone"
          workspaceFrameClassName="min-h-0 border-0 bg-page"
          contentClassName={selectedItem ? 'pt-1' : undefined}
        />
      </div>
      <p className="text-xs leading-5 text-text-muted">Summary starts full width with creation centered and organization in More actions. Selecting an item opens its workspace; selecting a student then activates the resizable inspector. Classwork and Tests retain their own labels, statuses, and commands.</p>
    </div>
  )
}
