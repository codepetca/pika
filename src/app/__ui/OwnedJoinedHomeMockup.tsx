'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, CircleDot, GripVertical, LogIn, MoreVertical, Plus, RotateCw } from 'lucide-react'
import { TeacherWorkSurfaceIconMenuButton, type TeacherWorkSurfaceActionItem } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { Button, Card, ConfirmDialog, ContentDialog, FormField, IconButton, Input, PageActionBar, PageHeading, PageState, SegmentedControl, Select, TabPanel, Tabs, cn } from '@/ui'
import { classroomsForExample, JOIN_EXAMPLE, type HomeClassroomExample, type HomeExampleAccount, type HomeRelationship } from './owned-joined-home-fixtures'

type HomeFilter = 'all' | HomeRelationship
type HomeState = 'populated' | 'loading' | 'error'
const FILTERS = [{ value: 'all', label: 'All' }, { value: 'teaching', label: 'Teaching' }, { value: 'joined', label: 'Joined' }] as const
const PREVIEW_TABS = {
  teaching: ['Daily', 'Classwork', 'Tests', 'Gradebook', 'Roster', 'Settings'],
  joined: ['Today', 'Classwork', 'Tests', 'Grades', 'Resources'],
}

/** Review-only composition. No live identity, plan, API or persistence is consulted. */
export function OwnedJoinedHomeMockup({ role }: { role: 'teacher' | 'student' }) {
  const [account, setAccount] = useState<HomeExampleAccount>(role === 'teacher' ? 'mixed' : 'joined')
  const [creationAccess, setCreationAccess] = useState(role === 'teacher' ? 'allowed' : 'unavailable')
  const [state, setState] = useState<HomeState>('populated')
  // Each account selection mounts a fresh deterministic example, including form state.
  return (
    <div className="space-y-4" data-testid="owned-joined-home-prototype">
      <Card tone="muted" padding="sm">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Account example">
            <Select value={account} onChange={(event) => { setAccount(event.target.value as HomeExampleAccount); setState('populated') }} options={[
              { value: 'mixed', label: 'Teaching and joined' }, { value: 'teaching', label: 'Teaching only' },
              { value: 'joined', label: 'Joined only' }, { value: 'new', label: 'New account' },
            ]} />
          </FormField>
          <FormField label="Creation access">
            <Select value={creationAccess} onChange={(event) => setCreationAccess(event.target.value)} options={[
              { value: 'allowed', label: 'Allowed' },
              { value: 'unavailable', label: 'Not available' },
            ]} />
          </FormField>
          <FormField label="Home state">
            <Select value={state} onChange={(event) => setState(event.target.value as HomeState)} options={[
              { value: 'populated', label: 'Populated' }, { value: 'loading', label: 'Loading' }, { value: 'error', label: 'Error' },
            ]} />
          </FormField>
        </div>
        <p className="mt-2 text-xs text-text-muted">Prototype controls only. Teaching means ownership; creation access is a separate permission.</p>
      </Card>
      <HomeExample key={account} account={account} canCreate={creationAccess === 'allowed'} state={state} onRetry={() => setState('populated')} />
    </div>
  )
}

function HomeExample({ account, canCreate, state, onRetry }: { account: HomeExampleAccount; canCreate: boolean; state: HomeState; onRetry: () => void }) {
  const [classrooms, setClassrooms] = useState(() => classroomsForExample(account))
  const [filter, setFilter] = useState<HomeFilter>('all')
  const [archived, setArchived] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null)
  const [preview, setPreview] = useState<HomeClassroomExample | null>(null)
  const [previewTab, setPreviewTab] = useState('Daily')
  const [archiveTarget, setArchiveTarget] = useState<HomeClassroomExample | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [joinConfirmed, setJoinConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('Example only. Nothing is saved to your account.')
  const nextId = useRef(1)
  const backRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'back' | 'filters' | 'heading' | null>(null)
  const previewId = useId()
  const owned = classrooms.filter((classroom) => classroom.relationship === 'teaching')
  const visible = classrooms.filter((classroom) => classroom.archived === archived && (filter === 'all' || classroom.relationship === filter))
  const groups: HomeRelationship[] = filter === 'all' ? ['teaching', 'joined'] : [filter]

  // A removed row/empty-state opener cannot receive the shared dialog's return focus.
  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target === 'back') backRef.current?.focus()
    if (target === 'heading') headingRef.current?.focus()
    if (target === 'filters') filtersRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
  })

  function openForm(next: 'create' | 'join') {
    setName(''); setCode(''); setError(''); setJoinConfirmed(false); setDialog(next)
  }
  function resetView() { setArchived(false); setEditing(false); setFilter('all') }
  function returnToActiveList() { pendingFocus.current = 'heading'; resetView() }
  function reorder(id: string, direction: -1 | 1) {
    const teaching = classrooms.filter((classroom) => classroom.relationship === 'teaching' && !classroom.archived)
    const index = teaching.findIndex((classroom) => classroom.id === id)
    const neighbor = teaching[index + direction]
    if (!neighbor) return
    setClassrooms((current) => {
      const result = [...current]
      const from = result.findIndex((classroom) => classroom.id === id)
      const to = result.findIndex((classroom) => classroom.id === neighbor.id)
      ;[result[from], result[to]] = [result[to], result[from]]
      return result
    })
    setMessage('Order updated in this example only.')
  }

  const menuItems: TeacherWorkSurfaceActionItem[] = [
    ...(canCreate ? [{ id: 'create', label: 'New Classroom', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect: () => openForm('create') }] : []),
    { id: 'join', label: 'Join classroom', icon: <LogIn className="h-4 w-4" aria-hidden="true" />, onSelect: () => openForm('join') },
    ...(owned.length ? [
      { id: 'edit', label: 'Edit classrooms', icon: <GripVertical className="h-4 w-4" aria-hidden="true" />, checked: editing, checkedRole: 'menuitemcheckbox' as const, onSelect: () => { setArchived(false); setFilter('teaching'); setEditing((value) => !value) } },
      { id: 'archive', label: archived ? 'Show Active' : 'Show Archived', icon: archived ? <CircleDot className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />, dividerBefore: true, onSelect: () => { setArchived((value) => !value); setFilter('teaching'); setEditing(false) } },
    ] : []),
  ]

  return (
    <div className="rounded-card border border-border bg-page p-3 sm:p-4" data-testid="owned-joined-home-screen" onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || (!archived && !editing)) return
      // Portalled dialogs and the shared menu own their Escape before the list does.
      if (dialog || preview || archiveTarget || !event.currentTarget.contains(document.activeElement)) return
      if (event.currentTarget.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return
      event.preventDefault()
      returnToActiveList()
    }}>
      <div className="min-h-96">
        {!archived && <div ref={filtersRef} className="mb-3 flex justify-center"><SegmentedControl<HomeFilter> ariaLabel="Classroom relationship" value={filter} onChange={(value) => { setFilter(value); setEditing(false) }} options={[...FILTERS]} /></div>}
        <div className="mb-3">
          {(archived || editing) && <Button ref={backRef} variant="ghost" size="xs" className="-ml-2 mb-1 px-2 text-text-muted" onClick={returnToActiveList}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to classrooms</Button>}
          <PageActionBar className="px-0" primary={
            <PageHeading level="h3" size="section" title={archived ? 'Archived classrooms' : 'Active classrooms'} headingRef={headingRef} tabIndex={-1} />
          } trailing={<>
            {editing && <span className="text-xs font-medium text-primary">Editing</span>}
            <TeacherWorkSurfaceIconMenuButton ariaLabel="Classroom actions" menuAriaLabel="Home classroom actions" tooltip="Classroom actions" icon={<MoreVertical className="h-5 w-5" aria-hidden="true" />} items={menuItems} variant="ghost" menuPlacement="down" menuAlign="end" menuClassName="w-64" />
          </>} />
        </div>

        {state === 'loading' ? <PageState compact kind="loading" title="Loading classrooms" /> : state === 'error' ? (
          <PageState compact kind="error" title="Classrooms couldn’t load" description="Try again to see your classrooms." action={<IconButton icon={RotateCw} label="Try again" onClick={onRetry} />} />
        ) : visible.length === 0 ? (
          <PageState compact kind="empty" title={archived ? 'No archived classrooms' : filter === 'teaching' ? 'No classrooms you’re teaching' : filter === 'joined' ? 'No joined classrooms' : 'No classrooms yet'} action={archived ? undefined : (
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => openForm('join')}>Join classroom</Button>
              {canCreate && <Button variant="secondary" onClick={() => openForm('create')}>New Classroom</Button>}
            </div>
          )} />
        ) : (
          <div className="space-y-5" data-testid="home-classroom-list">
            {groups.map((relationship) => {
              const rows = visible.filter((classroom) => classroom.relationship === relationship)
              if (!rows.length) return null
              return <section key={relationship} aria-label={relationship === 'teaching' ? 'Teaching classrooms' : 'Joined classrooms'}>
                <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
                  <h4 className="font-medium">{relationship === 'teaching' ? 'Teaching' : 'Joined'}</h4><span>{rows.length}</span>
                </div>
                <div className="space-y-2">
                  {rows.map((classroom, index) => (
                    <Card key={classroom.id} tone="panel" padding="none" interactive>
                      <div className="flex min-h-20 items-center gap-2 px-3 py-3 sm:gap-4 sm:px-4">
                        <div className="flex min-w-8 justify-center"><span className={cn('h-8 w-1.5 rounded-full', classroom.accent)} aria-hidden="true" /></div>
                        <Button variant="ghost" size="sm" className="h-auto min-h-control min-w-0 flex-1 justify-start px-1 text-left" aria-label={`Open ${classroom.title}`} onClick={() => { setPreview(classroom); setPreviewTab(classroom.relationship === 'teaching' ? 'Daily' : 'Today') }}>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="break-words font-semibold text-text-default">{classroom.title}</span><span className="text-sm font-normal text-text-muted">{classroom.term}</span></span>
                            <span className="mt-1 block text-sm font-normal text-text-muted">{classroom.dates}</span>
                            <span className="mt-1 block text-xs font-normal text-text-muted sm:hidden">{classroom.detail}</span>
                          </span>
                        </Button>
                        {!editing && !archived && <span className="hidden shrink-0 text-xs text-text-muted sm:block">{classroom.detail}</span>}
                        {editing && relationship === 'teaching' && <div className="flex shrink-0 flex-col sm:flex-row">
                          <IconButton icon={ArrowUp} label={`Move ${classroom.title} up`} disabled={index === 0} variant="ghost" onClick={() => reorder(classroom.id, -1)} />
                          <IconButton icon={ArrowDown} label={`Move ${classroom.title} down`} disabled={index === rows.length - 1} variant="ghost" onClick={() => reorder(classroom.id, 1)} />
                          <IconButton icon={Archive} label={`Archive ${classroom.title}`} variant="ghost" onClick={() => setArchiveTarget(classroom)} />
                        </div>}
                        {archived && relationship === 'teaching' && <IconButton icon={ArchiveRestore} label={`Restore ${classroom.title}`} variant="ghost" onClick={() => { pendingFocus.current = 'back'; setClassrooms((current) => current.map((row) => row.id === classroom.id ? { ...row, archived: false } : row)); setMessage(`${classroom.title} restored in this example only.`) }} />}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            })}
          </div>
        )}
      </div>
      <p role="status" className="mt-3 text-xs text-text-muted">{message}</p>

      <ContentDialog isOpen={dialog === 'create'} onClose={() => setDialog(null)} title="New Classroom" subtitle="Prototype · local example only" showFooterClose={false} maxWidth="max-w-md">
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          if (!canCreate) { setError('Classroom creation is not available in this example.'); return }
          if (!name.trim()) { setError('Enter a classroom name.'); return }
          setClassrooms((current) => [...current, { id: `new-example-${nextId.current++}`, title: name.trim(), term: 'Semester 1', dates: 'Sep 1, 2026 – Jan 29, 2027', detail: '0 students', accent: 'bg-info', relationship: 'teaching', archived: false }])
          pendingFocus.current = 'filters'; resetView(); setFilter('teaching'); setDialog(null); setMessage('Classroom created in this example only.')
        }}>
          <FormField label="Classroom name" error={error || undefined}><Input value={name} maxLength={100} onChange={(event) => { setName(event.target.value); setError('') }} /></FormField>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={!canCreate}>Create example classroom</Button></div>
        </form>
      </ContentDialog>
      <ContentDialog isOpen={dialog === 'join'} onClose={() => setDialog(null)} title="Join classroom" subtitle="Prototype · local example only" showFooterClose={false} maxWidth="max-w-md">
        {joinConfirmed ? <div className="space-y-4">
          <Card tone="muted" padding="sm"><p className="font-semibold">{JOIN_EXAMPLE.title}</p><p className="mt-1 text-sm text-text-muted">{JOIN_EXAMPLE.detail} · {JOIN_EXAMPLE.term}</p></Card>
          <p className="text-sm text-text-muted">You’ll join as a student in this classroom.</p>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setJoinConfirmed(false)}>Back</Button><Button onClick={() => {
            setClassrooms((current) => current.some((row) => row.id === JOIN_EXAMPLE.id) ? current : [...current, { ...JOIN_EXAMPLE }])
            pendingFocus.current = 'filters'; resetView(); setFilter('joined'); setDialog(null); setMessage('Classroom joined in this example only.')
          }}>Join example classroom</Button></div>
        </div> : <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          if (code.trim().toUpperCase() !== 'DEMO26') { setError('Use the demo code DEMO26. No real codes are checked.'); return }
          if (classrooms.some((row) => row.id === JOIN_EXAMPLE.id)) { setError('You already joined this example classroom.'); return }
          setError(''); setJoinConfirmed(true)
        }}>
          <FormField label="Class code" hint="Try DEMO26. This preview never checks a real classroom." error={error || undefined}><Input value={code} maxLength={30} autoComplete="off" onChange={(event) => { setCode(event.target.value); setError('') }} /></FormField>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button type="submit">Continue</Button></div>
        </form>}
      </ContentDialog>
      <ContentDialog isOpen={preview !== null} onClose={() => setPreview(null)} title={preview?.title ?? 'Classroom preview'} subtitle={`${preview?.relationship === 'teaching' ? 'Teaching' : 'Joined'} · navigation preview only`}>
        {preview && <>
          <Tabs ariaLabel="Classroom preview navigation" value={previewTab} onValueChange={setPreviewTab} items={PREVIEW_TABS[preview.relationship].map((label) => ({ value: label, label }))} getTabId={(value) => `${previewId}-${value}-tab`} getPanelId={(value) => `${previewId}-${value}-panel`} />
          {PREVIEW_TABS[preview.relationship].map((tab) => <div key={tab} hidden={previewTab !== tab}>
          <TabPanel id={`${previewId}-${tab}-panel`} labelledBy={`${previewId}-${tab}-tab`} className="py-5" focusable>
            <PageHeading level="h3" size="section" title={tab} />
            <p className="mt-2 text-sm text-text-muted">{preview.relationship === 'teaching' ? 'Your teaching workspace for this classroom.' : 'Your student workspace for this classroom.'}</p>
            <p className="mt-3 text-xs text-text-muted">Navigation preview only. No classroom data is loaded. {preview.archived ? 'This classroom is archived; participation is unavailable.' : 'The live classroom workflows are unchanged.'}</p>
          </TabPanel></div>)}
        </>}
      </ContentDialog>
      <ConfirmDialog isOpen={archiveTarget !== null} onCancel={() => setArchiveTarget(null)} title={`Archive ${archiveTarget?.title ?? 'classroom'}?`} description="This changes only the prototype. No real classroom or student work is affected." confirmLabel="Archive example" onConfirm={() => {
        pendingFocus.current = 'back'
        setClassrooms((current) => current.map((row) => row.id === archiveTarget?.id ? { ...row, archived: true } : row))
        setArchiveTarget(null); setMessage('Classroom archived in this example only.')
      }} />
    </div>
  )
}
