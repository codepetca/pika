'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, CircleAlert, ClipboardList, LayoutDashboard, UsersRound, type LucideIcon } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { LeftSidebar, MainContent, ThreePanelProvider, ThreePanelShell, useLeftSidebar, useMobileDrawer } from '@/components/layout'
import {
  Button,
  Card,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  FormField,
  Input,
  PageContent,
  PageHeading,
  PageStack,
  Select,
  TableCard,
  Tooltip,
} from '@/ui'

type Plan = 'free' | 'basic' | 'plus' | 'pro'
type AccountStatus = 'healthy' | 'retrying' | 'investigate'
type Account = {
  id: string
  email: string
  plan: Plan | null
  grantLimit: number | null
  grantSource: 'automation' | 'legacy' | null
  activeClassrooms: number
  status: AccountStatus
  lastChecked: string
  exceptionTitle?: string
  observed?: string
  systemResponse?: string
  nextCheck?: string
}
type AutomationEvent = {
  id: string
  accountId: string
  title: string
  detail: string
  time: string
  status: AccountStatus
}

const ACCOUNTS: Account[] = [
  { id: 'a2060000-0000-4000-8000-000000000001', email: 'alex@example.invalid', plan: 'pro', grantLimit: 10, grantSource: 'automation', activeClassrooms: 7, status: 'healthy', lastChecked: 'Sep 25, 9:18 AM' },
  { id: 'a2060000-0000-4000-8000-000000000002', email: 'morgan@example.invalid', plan: 'plus', grantLimit: 5, grantSource: 'automation', activeClassrooms: 3, status: 'healthy', lastChecked: 'Sep 25, 9:12 AM' },
  {
    id: 'a2060000-0000-4000-8000-000000000003',
    email: 'sam@example.invalid',
    plan: null,
    grantLimit: null,
    grantSource: null,
    activeClassrooms: 0,
    status: 'retrying',
    lastChecked: 'Sep 25, 9:06 AM',
    exceptionTitle: 'Provisioning is still pending',
    observed: 'The source event arrived, but the account has no assigned tier or creation grant yet.',
    systemResponse: 'An automatic retry is scheduled. No operator change has been made.',
    nextCheck: 'Check whether the next run completes and records an entitlement.',
  },
  {
    id: 'a2060000-0000-4000-8000-000000000004',
    email: 'taylor@example.invalid',
    plan: 'basic',
    grantLimit: 1,
    grantSource: 'legacy',
    activeClassrooms: 1,
    status: 'investigate',
    lastChecked: 'Sep 25, 8:54 AM',
    exceptionTitle: 'Entitlement does not match the tier',
    observed: 'The account is Basic, but its recorded creation grant is 1 instead of 2.',
    systemResponse: 'The discrepancy was flagged for investigation; automation did not overwrite the legacy grant.',
    nextCheck: 'Compare the source event and grant history to find why they differ.',
  },
]

const EVENTS: AutomationEvent[] = [
  { id: 'event-4', accountId: ACCOUNTS[0].id, title: 'Tier sync completed', detail: 'Pro tier and creation grant agree.', time: 'Sep 25, 9:18 AM', status: 'healthy' },
  { id: 'event-3', accountId: ACCOUNTS[1].id, title: 'Entitlement check completed', detail: 'Plus tier and creation grant agree.', time: 'Sep 25, 9:12 AM', status: 'healthy' },
  { id: 'event-2', accountId: ACCOUNTS[2].id, title: 'Provisioning retry scheduled', detail: 'The account is waiting for an automatic retry.', time: 'Sep 25, 9:06 AM', status: 'retrying' },
  { id: 'event-1', accountId: ACCOUNTS[3].id, title: 'Entitlement discrepancy detected', detail: 'A legacy grant differs from the current tier.', time: 'Sep 25, 8:54 AM', status: 'investigate' },
]

type Section = 'overview' | 'accounts' | 'exceptions' | 'activity'
type Screen = Section | 'account' | 'exception'

const SECTIONS: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'accounts', label: 'Accounts', icon: UsersRound },
  { id: 'exceptions', label: 'Exceptions', icon: CircleAlert },
  { id: 'activity', label: 'Activity', icon: ClipboardList },
]

function AdminPrototypeNav({ active, onNavigate }: { active: Section; onNavigate: (section: Section) => void }) {
  const { isExpanded } = useLeftSidebar()
  const { isLeftOpen, close } = useMobileDrawer()
  const showLabels = isExpanded || isLeftOpen

  return <nav aria-label="Admin sections" className="flex min-h-0 flex-1 flex-col gap-1">
    {SECTIONS.map(({ id, label, icon: Icon }) => {
      const item = <Button
        key={id}
        type="button"
        variant="ghost"
        onClick={() => { onNavigate(id); close() }}
        aria-current={active === id ? 'page' : undefined}
        aria-label={label}
        className={[
          'group flex h-12 w-full items-center rounded-control border-transparent text-base font-medium transition-colors',
          showLabels ? 'justify-start gap-3 px-3' : 'justify-center px-0',
          active === id ? 'bg-surface-selected text-text-default shadow-sm' : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
          'focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus',
        ].join(' ')}
      >
        <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
        {showLabels ? <span className="truncate">{label}</span> : null}
      </Button>
      return <span key={id} className="block">{showLabels ? item : <Tooltip content={label}>{item}</Tooltip>}</span>
    })}
  </nav>
}

function AdminPrototypeFrame({ children, screen, onNavigate }: { children: React.ReactNode; screen: Screen; onNavigate: (section: Section) => void }) {
  const { openLeft } = useMobileDrawer()
  const activeSection: Section = screen === 'account' ? 'accounts' : screen === 'exception' ? 'exceptions' : screen

  return <AppShell
    pageTitle={<span className="text-sm font-semibold">Administration</span>}
    onOpenSidebar={openLeft}
    sidebarTriggerLabel="Open admin navigation"
    mainClassName="max-w-none px-0 py-0"
  >
    <ThreePanelShell>
      <LeftSidebar><AdminPrototypeNav active={activeSection} onNavigate={onNavigate} /></LeftSidebar>
      <MainContent density="teacher" maxWidth="wide">
        <PageContent className="px-1 sm:px-3">
          <PageStack>{children}</PageStack>
        </PageContent>
      </MainContent>
    </ThreePanelShell>
  </AppShell>
}

function PlanLabel({ plan }: { plan: Plan | null }) {
  return <span className={plan ? 'font-medium text-text-default' : 'text-text-muted'}>{plan ? plan[0].toUpperCase() + plan.slice(1) : 'Unclassified'}</span>
}

function StatusLabel({ status }: { status: AccountStatus }) {
  const label = status === 'healthy' ? 'In sync' : status === 'retrying' ? 'Retry scheduled' : 'Needs investigation'
  return <span className={'font-medium ' + (status === 'healthy' ? 'text-success' : 'text-warning')}>{label}</span>
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="border-b border-border py-3 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4"><dt className="text-sm text-text-muted">{label}</dt><dd className="mt-1 break-words text-sm text-text-default sm:col-span-2 sm:mt-0">{children}</dd></div>
}

function EventRow({ event }: { event: AutomationEvent }) {
  const account = ACCOUNTS.find((item) => item.id === event.accountId)
  return <div className="border-b border-border py-4 last:border-b-0 sm:flex sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0">
      <p className="text-sm font-medium">{event.title}</p>
      <p className="mt-1 text-sm text-text-muted">{account?.email} · {event.detail}</p>
      <p className="mt-1 text-xs text-text-muted">Automated workflow</p>
    </div>
    <div className="mt-2 shrink-0 text-sm sm:mt-0 sm:text-right">
      <StatusLabel status={event.status} />
      <p className="mt-1 text-text-muted">{event.time}</p>
    </div>
  </div>
}

export function AdminPrototype() {
  return <ThreePanelProvider routeKey="roster" initialLeftExpanded persistLeftSidebar={false}><AdminPrototypeContent /></ThreePanelProvider>
}

function AdminPrototypeContent() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const hasMounted = useRef(false)
  const [screen, setScreen] = useState<Screen>('overview')
  const [selectedId, setSelectedId] = useState(ACCOUNTS[0].id)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const account = ACCOUNTS.find((item) => item.id === selectedId) ?? ACCOUNTS[0]
  const exceptions = ACCOUNTS.filter((item) => item.status !== 'healthy')
  const filtered = useMemo(() => ACCOUNTS.filter((item) => {
    const term = query.trim().toLowerCase()
    return (!term || item.email.includes(term) || item.id.includes(term)) && (filter === 'all' || item.status === filter)
  }), [query, filter])

  function openAccount(id: string) {
    setSelectedId(id)
    setScreen('account')
  }

  function openException(id: string) {
    setSelectedId(id)
    setScreen('exception')
  }

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }
    headingRef.current?.focus({ preventScroll: true })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [screen, selectedId])

  return (
    <AdminPrototypeFrame screen={screen} onNavigate={setScreen}>
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border pb-3">
        <span className="rounded-badge border border-border bg-surface-2 px-2 py-1 text-xs text-text-muted">Fictional sample data</span>
      </div>

      {screen === 'overview' ? <>
        <PageHeading title="Overview" description="Account automation at a glance" headingRef={headingRef} tabIndex={-1} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Card padding="md"><p className="text-sm text-text-muted">Accounts monitored</p><p className="mt-2 text-3xl font-semibold">{ACCOUNTS.length}</p><p className="mt-2 text-xs text-text-muted">In this fictional sample</p></Card>
          <Card padding="md"><p className="text-sm text-text-muted">In sync</p><p className="mt-2 text-3xl font-semibold">{ACCOUNTS.filter((item) => item.status === 'healthy').length}</p><p className="mt-2 text-xs text-text-muted">Latest automated check completed</p></Card>
          <Card padding="md"><p className="text-sm text-text-muted">Exceptions</p><p className="mt-2 text-3xl font-semibold">{exceptions.length}</p><p className="mt-2 text-xs text-text-muted">Retrying or needs investigation</p></Card>
        </div>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><PageHeading level="h2" size="section" title="Needs attention" /><p className="mt-1 text-sm text-text-muted">Automation outcomes to monitor or investigate.</p></div>
            <Button type="button" variant="secondary" onClick={() => setScreen('exceptions')}>View exceptions</Button>
          </div>
          <div className="mt-4 divide-y divide-border border-t border-border">
            {exceptions.map((item) => <Button key={item.id} type="button" variant="ghost" onClick={() => openException(item.id)} className="flex min-h-14 w-full flex-col items-start gap-1 rounded-none border-0 px-0 py-3 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus sm:flex-row sm:items-center sm:justify-between sm:gap-3"><span className="min-w-0"><span className="block text-sm font-medium">{item.exceptionTitle}</span><span className="block break-all text-xs text-text-muted">{item.email}</span></span><span className="shrink-0 text-sm"><StatusLabel status={item.status} /></span></Button>)}
          </div>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3"><PageHeading level="h2" size="section" title="Recent activity" /><Button type="button" variant="secondary" onClick={() => setScreen('activity')}>View activity</Button></div>
          <div className="mt-3">{EVENTS.slice(0, 2).map((event) => <EventRow key={event.id} event={event} />)}</div>
        </Card>
      </> : null}

      {screen === 'accounts' ? <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <PageHeading title="Accounts" description="Find an account and inspect its observed state." headingRef={headingRef} tabIndex={-1} />
          <span className="text-sm text-text-muted">{filtered.length} of {ACCOUNTS.length} sample accounts</span>
        </div>
        <Card padding="md" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Find account" className="sm:col-span-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email or ID" /></FormField>
            <FormField label="Automation status"><Select value={filter} onChange={(event) => setFilter(event.target.value)} options={[{ value: 'all', label: 'All statuses' }, { value: 'healthy', label: 'In sync' }, { value: 'retrying', label: 'Retry scheduled' }, { value: 'investigate', label: 'Needs investigation' }]} /></FormField>
          </div>
          <div className="hidden md:block"><TableCard overflowX chrome="flush">
            <DataTable density="compact" className="min-w-full">
              <caption className="sr-only">Sample account inventory</caption>
              <DataTableHead><DataTableRow>
                <DataTableHeaderCell scope="col">Account</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Current tier</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Active classrooms</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Creation grant</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Automation</DataTableHeaderCell>
                <DataTableHeaderCell scope="col" align="right">Details</DataTableHeaderCell>
              </DataTableRow></DataTableHead>
              <DataTableBody>{filtered.map((item) => <DataTableRow key={item.id}>
                <DataTableCell><span className="font-medium">{item.email}</span><span className="mt-0.5 block text-xs text-text-muted">{item.id.slice(0, 8)}…</span></DataTableCell>
                <DataTableCell><PlanLabel plan={item.plan} /></DataTableCell>
                <DataTableCell>{item.activeClassrooms}</DataTableCell>
                <DataTableCell>{item.grantLimit ?? '—'}</DataTableCell>
                <DataTableCell><StatusLabel status={item.status} /></DataTableCell>
                <DataTableCell align="right"><Button type="button" size="sm" variant="ghost" onClick={() => openAccount(item.id)} aria-label={'View ' + item.email}>View <ChevronRight className="ml-1 inline" size={16} aria-hidden="true" /></Button></DataTableCell>
              </DataTableRow>)}</DataTableBody>
            </DataTable>
          </TableCard></div>
          <div className="divide-y divide-border md:hidden">{filtered.map((item) => <div key={item.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.email}</p><p className="mt-1 text-xs text-text-muted">{item.id.slice(0, 8)}…</p></div><PlanLabel plan={item.plan} /></div>
            <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs text-text-muted">{item.activeClassrooms} active · grant {item.grantLimit ?? '—'}</p><p className="mt-1 text-sm"><StatusLabel status={item.status} /></p></div><Button type="button" size="sm" variant="secondary" onClick={() => openAccount(item.id)} aria-label={'Open ' + item.email}>View</Button></div>
          </div>)}</div>
          {filtered.length === 0 ? <p role="status" className="py-6 text-center text-sm text-text-muted">No sample accounts match this search.</p> : null}
        </Card>
      </> : null}

      {screen === 'account' ? <>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setScreen('accounts')}><ArrowLeft size={16} className="mr-2" aria-hidden="true" />Back to accounts</Button>
        <PageHeading title={account.email} description="Read-only account state and automation history" headingRef={headingRef} tabIndex={-1} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><PageHeading level="h2" size="section" title="Account state" />
            <dl className="mt-3"><Detail label="Account ID"><span className="font-mono text-xs">{account.id}</span></Detail><Detail label="Current tier"><PlanLabel plan={account.plan} /></Detail><Detail label="Active classrooms">{account.activeClassrooms}</Detail><Detail label="Creation grant">{account.grantLimit ?? '—'}</Detail><Detail label="Grant source">{account.grantSource ?? '—'}</Detail></dl>
          </Card>
          <Card tone={account.status === 'healthy' ? 'muted' : 'accent'}><PageHeading level="h2" size="section" title="Automation status" />
            <p className="mt-4 text-sm"><StatusLabel status={account.status} /></p>
            <p className="mt-2 text-sm text-text-muted">Last checked {account.lastChecked}</p>
            {account.exceptionTitle ? <p className="mt-3 text-sm">{account.exceptionTitle}</p> : <p className="mt-3 text-sm">The latest automated check found no discrepancy.</p>}
            {account.exceptionTitle ? <Button type="button" variant="secondary" className="mt-4" onClick={() => openException(account.id)}>View exception</Button> : null}
          </Card>
        </div>
        <Card><PageHeading level="h2" size="section" title="Recent activity" /><div className="mt-3">{EVENTS.filter((event) => event.accountId === account.id).map((event) => <EventRow key={event.id} event={event} />)}</div></Card>
      </> : null}

      {screen === 'exceptions' ? <>
        <PageHeading title="Exceptions" description="Automated outcomes that need monitoring or investigation." headingRef={headingRef} tabIndex={-1} />
        <div className="space-y-3">{exceptions.map((item) => <Card key={item.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><PageHeading level="h2" size="section" title={item.exceptionTitle ?? 'Exception'} /><p className="mt-1 text-sm text-text-muted">{item.email}</p></div>
            <StatusLabel status={item.status} />
          </div>
          <p className="mt-3 text-sm">{item.observed}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-text-muted">Detected {item.lastChecked}</p><Button type="button" variant="secondary" onClick={() => openException(item.id)} aria-label={'Inspect ' + item.email}>Inspect <ChevronRight className="ml-1 inline" size={16} aria-hidden="true" /></Button></div>
        </Card>)}</div>
      </> : null}

      {screen === 'exception' ? <>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setScreen('exceptions')}><ArrowLeft size={16} className="mr-2" aria-hidden="true" />Back to exceptions</Button>
        <PageHeading title={account.exceptionTitle ?? 'Exception'} description={account.email} headingRef={headingRef} tabIndex={-1} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><PageHeading level="h2" size="section" title="What happened" /><dl className="mt-3"><Detail label="Observed state">{account.observed}</Detail><Detail label="Detected">{account.lastChecked}</Detail><Detail label="Status"><StatusLabel status={account.status} /></Detail></dl></Card>
          <Card tone="muted"><PageHeading level="h2" size="section" title="System response" /><p className="mt-3 text-sm">{account.systemResponse}</p><p className="mt-4 text-sm font-medium">Next check</p><p className="mt-1 text-sm text-text-muted">{account.nextCheck}</p></Card>
        </div>
        <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><PageHeading level="h2" size="section" title="Account context" /><p className="mt-1 text-sm text-text-muted">Current tier: <PlanLabel plan={account.plan} /> · creation grant: {account.grantLimit ?? '—'}</p></div><Button type="button" variant="secondary" onClick={() => setScreen('account')}>View account</Button></div></Card>
      </> : null}

      {screen === 'activity' ? <>
        <PageHeading title="Activity" description="Recent automated account events" headingRef={headingRef} tabIndex={-1} />
        <Card><div className="divide-y divide-border">{EVENTS.map((event) => <EventRow key={event.id} event={event} />)}</div></Card>
      </> : null}
    </AdminPrototypeFrame>
  )
}
