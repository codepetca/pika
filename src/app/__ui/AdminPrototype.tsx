'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, ClipboardList, LayoutDashboard, Layers3, UsersRound, type LucideIcon } from 'lucide-react'
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
import { useTheme } from '@/contexts/ThemeContext'

type Plan = 'free' | 'basic' | 'plus' | 'pro'
type Account = {
  id: string
  email: string
  plan: Plan | null
  revision: number
  grantLimit: number | null
  grantSource: 'plan' | 'manual' | null
  activeClassrooms: number
  access: 'ready' | 'unclassified' | 'mismatch'
  lastChange: string
}

const PLAN_LIMITS: Record<Plan, number> = { free: 0, basic: 2, plus: 5, pro: 10 }
const PLAN_OPTIONS = [
  { value: 'free', label: 'Free · 0 classrooms' },
  { value: 'basic', label: 'Basic · 2 classrooms' },
  { value: 'plus', label: 'Plus · 5 classrooms' },
  { value: 'pro', label: 'Pro · 10 classrooms' },
]

const ACCOUNTS: Account[] = [
  { id: 'a2060000-0000-4000-8000-000000000001', email: 'alex@example.invalid', plan: 'pro', revision: 2, grantLimit: 10, grantSource: 'plan', activeClassrooms: 7, access: 'ready', lastChange: 'Sep 23, 2026' },
  { id: 'a2060000-0000-4000-8000-000000000002', email: 'morgan@example.invalid', plan: 'plus', revision: 1, grantLimit: 5, grantSource: 'plan', activeClassrooms: 3, access: 'ready', lastChange: 'Sep 23, 2026' },
  { id: 'a2060000-0000-4000-8000-000000000003', email: 'sam@example.invalid', plan: null, revision: 0, grantLimit: null, grantSource: null, activeClassrooms: 0, access: 'unclassified', lastChange: '—' },
  { id: 'a2060000-0000-4000-8000-000000000004', email: 'taylor@example.invalid', plan: 'basic', revision: 3, grantLimit: 1, grantSource: 'manual', activeClassrooms: 1, access: 'mismatch', lastChange: 'Sep 21, 2026' },
]

type Section = 'overview' | 'accounts' | 'activity' | 'plans'
type Screen = Section | 'account' | 'preview'

const SECTIONS: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'accounts', label: 'Accounts', icon: UsersRound },
  { id: 'activity', label: 'Activity', icon: ClipboardList },
  { id: 'plans', label: 'Plans', icon: Layers3 },
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
  const activeSection: Section = screen === 'account' || screen === 'preview' ? 'accounts' : screen

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

function AccessLabel({ access }: { access: Account['access'] }) {
  const label = access === 'ready' ? 'In sync' : access === 'mismatch' ? 'Plan/grant mismatch' : 'Needs a plan'
  const tone = access === 'ready' ? 'text-success' : 'text-warning'
  return <span className={`font-medium ${tone}`}>{label}</span>
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="border-b border-border py-3 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4"><dt className="text-sm text-text-muted">{label}</dt><dd className="mt-1 break-words text-sm text-text-default sm:col-span-2 sm:mt-0">{children}</dd></div>
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
  const [proposedPlan, setProposedPlan] = useState<Plan>('basic')
  const { theme, toggleTheme } = useTheme()

  const account = ACCOUNTS.find((item) => item.id === selectedId) ?? ACCOUNTS[0]
  const filtered = useMemo(() => ACCOUNTS.filter((item) => {
    const term = query.trim().toLowerCase()
    const matchesQuery = !term || item.email.includes(term) || item.id.includes(term)
    const matchesFilter = filter === 'all' || item.access === filter
    return matchesQuery && matchesFilter
  }), [query, filter])

  function openAccount(id: string) {
    setSelectedId(id)
    setScreen('account')
  }

  function openPreview() {
    setProposedPlan(account.plan === 'basic' ? 'plus' : 'basic')
    setScreen('preview')
  }

  const currentLimit = account.grantLimit ?? 0
  const proposedLimit = PLAN_LIMITS[proposedPlan]
  const aboveLimit = account.activeClassrooms > proposedLimit
  const isSamePlan = account.plan === proposedPlan

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }
    headingRef.current?.focus()
  }, [screen, selectedId])

  return (
    <AdminPrototypeFrame screen={screen} onNavigate={setScreen}>
            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border pb-3">
              <span className="rounded-badge border border-border bg-surface-2 px-2 py-1 text-xs text-text-muted">Fictional sample data</span>
              <Button type="button" variant="ghost" size="sm" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'} theme</Button>
            </div>

            {screen === 'overview' ? <>
              <PageHeading title="Overview" description="Sample account and plan status" headingRef={headingRef} tabIndex={-1} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Card padding="md"><p className="text-sm text-text-muted">Accounts</p><p className="mt-2 text-3xl font-semibold">{ACCOUNTS.length}</p><p className="mt-2 text-xs text-text-muted">In this fictional sample</p></Card>
                <Card padding="md"><p className="text-sm text-text-muted">Needs a plan</p><p className="mt-2 text-3xl font-semibold">{ACCOUNTS.filter((item) => item.access === 'unclassified').length}</p><p className="mt-2 text-xs text-text-muted">Unclassified account</p></Card>
                <Card padding="md"><p className="text-sm text-text-muted">Grant mismatch</p><p className="mt-2 text-3xl font-semibold">{ACCOUNTS.filter((item) => item.access === 'mismatch').length}</p><p className="mt-2 text-xs text-text-muted">Needs review before changes</p></Card>
              </div>
              <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><PageHeading level="h2" size="section" title="Accounts to review" /><p className="mt-1 text-sm text-text-muted">Plan and classroom-creation grants that need attention.</p></div><Button type="button" variant="secondary" onClick={() => setScreen('accounts')}>View accounts</Button></div><div className="mt-4 divide-y divide-border border-t border-border">{ACCOUNTS.filter((item) => item.access !== 'ready').map((item) => <Button key={item.id} type="button" variant="ghost" onClick={() => openAccount(item.id)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-none border-0 px-0 py-3 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus"><span className="min-w-0 truncate text-sm font-medium">{item.email}</span><span className="shrink-0 text-sm"><AccessLabel access={item.access} /></span></Button>)}</div></Card>
            </> : null}

            {screen === 'accounts' ? <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <PageHeading title="Accounts" description="Review plan and classroom creation capacity." headingRef={headingRef} tabIndex={-1} />
                <span className="text-sm text-text-muted">{filtered.length} of {ACCOUNTS.length} sample accounts</span>
              </div>
              <Card padding="md" className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label="Find account" className="sm:col-span-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email or ID" /></FormField>
                  <FormField label="Status"><Select value={filter} onChange={(event) => setFilter(event.target.value)} options={[{ value: 'all', label: 'All statuses' }, { value: 'ready', label: 'In sync' }, { value: 'unclassified', label: 'Needs a plan' }, { value: 'mismatch', label: 'Plan/grant mismatch' }]} /></FormField>
                </div>
                <div className="hidden md:block"><TableCard overflowX chrome="flush">
                  <DataTable density="compact" className="min-w-full">
                    <caption className="sr-only">Sample account inventory</caption>
                    <DataTableHead><DataTableRow>
                      <DataTableHeaderCell scope="col">Account</DataTableHeaderCell>
                      <DataTableHeaderCell scope="col">Plan</DataTableHeaderCell>
                      <DataTableHeaderCell scope="col">Active classrooms</DataTableHeaderCell>
                      <DataTableHeaderCell scope="col">Creation limit</DataTableHeaderCell>
                      <DataTableHeaderCell scope="col">Status</DataTableHeaderCell>
                      <DataTableHeaderCell scope="col" align="right">Details</DataTableHeaderCell>
                    </DataTableRow></DataTableHead>
                    <DataTableBody>{filtered.map((item) => <DataTableRow key={item.id}>
                      <DataTableCell><span className="font-medium">{item.email}</span><span className="mt-0.5 block text-xs text-text-muted">{item.id.slice(0, 8)}…</span></DataTableCell>
                      <DataTableCell><PlanLabel plan={item.plan} /></DataTableCell>
                      <DataTableCell>{item.activeClassrooms}</DataTableCell>
                      <DataTableCell>{item.grantLimit ?? '—'}</DataTableCell>
                      <DataTableCell><AccessLabel access={item.access} /></DataTableCell>
                      <DataTableCell align="right"><Button type="button" size="sm" variant="ghost" onClick={() => openAccount(item.id)} aria-label={`View ${item.email}`}>View <ChevronRight className="ml-1 inline" size={16} aria-hidden="true" /></Button></DataTableCell>
                    </DataTableRow>)}</DataTableBody>
                  </DataTable>
                </TableCard></div>
                <div className="divide-y divide-border md:hidden">{filtered.map((item) => <div key={item.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.email}</p><p className="mt-1 text-xs text-text-muted">{item.id.slice(0, 8)}…</p></div><PlanLabel plan={item.plan} /></div>
                  <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xs text-text-muted">{item.activeClassrooms} active · limit {item.grantLimit ?? '—'}</p><p className="mt-1 text-sm"><AccessLabel access={item.access} /></p></div><Button type="button" size="sm" variant="secondary" onClick={() => openAccount(item.id)} aria-label={`Open ${item.email}`}>View</Button></div>
                </div>)}</div>
                {filtered.length === 0 ? <p role="status" className="py-6 text-center text-sm text-text-muted">No sample accounts match this search.</p> : null}
              </Card>
            </> : null}

            {screen === 'account' ? <>
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setScreen('accounts')}><ArrowLeft size={16} className="mr-2" aria-hidden="true" />Back to accounts</Button>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <PageHeading title={account.email} description="Account plan and creation capacity" headingRef={headingRef} tabIndex={-1} />
                <Button type="button" onClick={openPreview}>Preview plan change</Button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><PageHeading level="h2" size="section" title="Account details" />
                  <dl className="mt-3"><Detail label="Account ID"><span className="font-mono text-xs">{account.id}</span></Detail><Detail label="Current plan"><PlanLabel plan={account.plan} /></Detail><Detail label="Plan revision">{account.revision || '—'}</Detail><Detail label="Grant source">{account.grantSource ?? '—'}</Detail><Detail label="Last plan change">{account.lastChange}</Detail></dl>
                </Card>
                <div className="space-y-4">
                  <Card><PageHeading level="h2" size="section" title="Classroom creation" />
                    <p className="mt-4 text-3xl font-semibold">{account.activeClassrooms}<span className="text-base font-normal text-text-muted"> / {account.grantLimit ?? '—'} active</span></p>
                    <p className="mt-2 text-sm text-text-muted">Existing classrooms remain available if a new plan lowers the limit.</p>
                  </Card>
                  <Card tone={account.access === 'ready' ? 'muted' : 'accent'}><PageHeading level="h2" size="section" title="Plan status" /><p className="mt-3 text-sm"><AccessLabel access={account.access} /></p><p className="mt-1 text-sm text-text-muted">{account.access === 'unclassified' ? 'No plan is assigned to this account.' : account.access === 'mismatch' ? 'The creation grant differs from the current plan.' : 'Plan and creation grant agree.'}</p></Card>
                </div>
              </div>
              <Card><PageHeading level="h2" size="section" title="Recent plan activity" /><div className="mt-4 border-t border-border py-4 text-sm"><p className="font-medium">{account.lastChange === '—' ? 'No plan activity' : 'Plan assignment recorded'}</p><p className="mt-1 text-text-muted">{account.lastChange === '—' ? 'This account has no plan history.' : `${account.lastChange} · revision ${account.revision}`}</p></div></Card>
            </> : null}

            {screen === 'preview' ? <>
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setScreen('account')}><ArrowLeft size={16} className="mr-2" aria-hidden="true" />Back to account</Button>
              <PageHeading title="Preview plan change" description={account.email} headingRef={headingRef} tabIndex={-1} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><PageHeading level="h2" size="section" title="Proposed change" />
                  <div className="mt-4 max-w-sm"><FormField label="Proposed plan"><Select value={proposedPlan} onChange={(event) => setProposedPlan(event.target.value as Plan)} options={PLAN_OPTIONS} /></FormField></div>
                  <dl className="mt-4"><Detail label="Current plan"><PlanLabel plan={account.plan} /></Detail><Detail label="Proposed plan"><PlanLabel plan={proposedPlan} /></Detail><Detail label="Current creation limit">{currentLimit}</Detail><Detail label="Proposed limit">{proposedLimit}</Detail><Detail label="Active classrooms">{account.activeClassrooms}</Detail><Detail label="Expected plan revision">{account.revision}</Detail></dl>
                </Card>
                <Card tone={account.access === 'mismatch' || aboveLimit ? 'accent' : 'muted'}><PageHeading level="h2" size="section" title="Impact and checks" />
                  <div className="mt-4 space-y-3 text-sm">
                    {account.access === 'mismatch' ? <p className="font-medium text-warning">Resolve the plan/grant mismatch before changing this plan.</p> : null}
                    {account.access === 'unclassified' ? <p className="text-text-muted">This account has no existing plan. Its first assignment would start at revision 1.</p> : null}
                    {aboveLimit ? <p className="font-medium text-warning">Current active classrooms remain available. New creation would stop.</p> : <p className="text-text-muted">The proposed limit leaves room for {Math.max(0, proposedLimit - account.activeClassrooms)} more active classrooms.</p>}
                    {isSamePlan ? <p className="text-text-muted">This is the account’s current plan.</p> : null}
                  </div>
                  <div className="mt-6 border-t border-border pt-4"><Button type="button" disabled fullWidth>Confirm plan change</Button><p className="mt-2 text-xs text-text-muted">Prototype only. No plan changes can be submitted here.</p></div>
                </Card>
              </div>
            </> : null}

            {screen === 'activity' ? <>
              <PageHeading title="Activity" description="Sample plan-change history" headingRef={headingRef} tabIndex={-1} />
              <Card><div className="divide-y divide-border">{ACCOUNTS.filter((item) => item.plan).map((item) => <div key={item.id} className="py-4 first:pt-0 last:pb-0 sm:flex sm:items-start sm:justify-between sm:gap-4"><div><p className="text-sm font-medium">{item.email}</p><p className="mt-1 text-sm text-text-muted">Plan recorded: <PlanLabel plan={item.plan} /> · revision {item.revision}</p></div><p className="mt-1 text-sm text-text-muted sm:mt-0">{item.lastChange}</p></div>)}</div></Card>
            </> : null}

            {screen === 'plans' ? <>
              <PageHeading title="Plans" description="Classroom creation limits by plan" headingRef={headingRef} tabIndex={-1} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.entries(PLAN_LIMITS) as Array<[Plan, number]>).map(([plan, limit]) => <Card key={plan} padding="md">
                  <PageHeading level="h2" size="section" title={plan[0].toUpperCase() + plan.slice(1)} />
                  <p className="mt-5 text-3xl font-semibold">{limit}</p>
                  <p className="mt-1 text-sm text-text-muted">active classroom{limit === 1 ? '' : 's'} allowed</p>
                </Card>)}
              </div>
              <Card tone="muted"><PageHeading level="h2" size="section" title="How plan changes appear" /><p className="mt-2 text-sm text-text-muted">Select an account to preview a plan change and its effect on classroom creation. Existing classrooms remain available when a new limit is lower.</p><Button type="button" variant="secondary" className="mt-4" onClick={() => setScreen('accounts')}>Browse accounts</Button></Card>
            </> : null}
    </AdminPrototypeFrame>
  )
}
