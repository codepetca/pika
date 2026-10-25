'use client'

import { useState, type ReactNode } from 'react'
import { Button, DataTable, DataTableBody, DataTableCell, DataTableHead, DataTableHeaderCell, DataTableRow, FormField, Input, PageState, Select } from '@/ui'
import type { ContributorDescriptor, PublicRepositoryBundle, ScopeFacts } from '@/lib/contracts/repolight/report/bundle-contract'
import { formatDayInZone } from '@/lib/contracts/repolight/engine/time'

export interface AssignmentRepositoryReportProps {
  bundle: PublicRepositoryBundle
  canImport: boolean
  onImportFeedback: (scopeKey: string, text: string) => Promise<void>
  importing?: boolean
  importError?: string
}

/** The parent owns authorization, source freshness and the containing dialog. */
export function AssignmentRepositoryReport(props: AssignmentRepositoryReportProps) {
  return <RepositoryReportView key={props.bundle.bundleRef} {...props} />
}

const kindLabel = (contributor: ContributorDescriptor) => contributor.kind === 'unknown_author' ? 'Unknown authors' : contributor.kind === 'unlinked_email' ? 'Unlinked author' : contributor.accountType === 'bot' ? 'Bot account' : contributor.accountType === 'user' ? 'GitHub account' : 'GitHub account · type unknown'
const readable = (value: string) => value.replaceAll('_', ' ')
const focusRegion = 'min-w-0 overflow-x-auto rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const linkStyle = 'break-all text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

function RepositoryReportView({bundle,canImport,onImportFeedback,importing = false,importError = ''}: AssignmentRepositoryReportProps) {
  const [scope,setScope] = useState(bundle.selection.status === 'matched' && bundle.selection.contributorId ? `contributor:${bundle.selection.contributorId}` : 'repository')
  const [evidence,setEvidence] = useState(false)
  const [drafts,setDrafts] = useState<Record<string,string>>({})
  const [pending,setPending] = useState(false)
  const [importedPreviews,setImportedPreviews] = useState<Record<string,string[]>>({})
  const [messages,setMessages] = useState<Record<string,{text:string;error:boolean;importedText?:string}>>({})
  const selected = bundle.contributors.find(entry => `contributor:${entry.contributor.id}` === scope)
  const analysis = selected?.analysis || bundle.overview
  const facts = analysis.facts
  const label = selected?.contributor.label || 'Repository overview'
  const feedback = drafts[scope] ?? analysis.ruleFeedback.feedbackDraft
  const unknown = selected?.contributor.kind === 'unknown_author'
  const status = messages[scope]
  const message = status?.importedText === undefined || status.importedText === feedback ? status : undefined
  const busy = pending || importing
  const alreadyImported = importedPreviews[scope]?.includes(feedback) ?? false

  function editFeedback(value: string) {
    setDrafts(current => ({...current,[scope]:value}))
    setMessages(current => ({...current,[scope]:{text:'',error:false}}))
  }
  async function importFeedback() {
    if (!canImport || busy || alreadyImported || !feedback.trim()) return
    const activeScope = scope
    setPending(true)
    setMessages(current => ({...current,[activeScope]:{text:'',error:false}}))
    try {
      await onImportFeedback(activeScope,feedback)
      setImportedPreviews(current => ({...current,[activeScope]:[...(current[activeScope] || []),feedback]}))
      setMessages(current => ({...current,[activeScope]:{text:'Added to the comment draft. Review it in Pika before sending.',error:false,importedText:feedback}}))
    } catch (caught) {
      setMessages(current => ({...current,[activeScope]:{text:caught instanceof Error ? caught.message : 'Could not add feedback. Your reviewed text is kept here.',error:true}}))
    } finally {setPending(false)}
  }

  return <div className="min-w-0 space-y-5 text-sm text-text-default" aria-label="Repository report">
    <div className="space-y-3">
      <FormField label="Report view"><Select value={scope} onChange={event => setScope(event.target.value)} options={[
        {value:'repository',label:'Repository overview'},
        ...bundle.contributors.map(({contributor}) => ({value:`contributor:${contributor.id}`,label:`${contributor.label} · ${kindLabel(contributor)}`})),
      ]} /></FormField>
      <h3 className="text-base font-semibold">{label}</h3>
      {!selected && bundle.selection.notice && <p className="text-text-muted">{bundle.selection.notice}</p>}
      {!selected && <p className="text-text-muted">Repository totals include all eligible contributors, including bots and unlinked authors. They do not represent one student’s work.</p>}
      {unknown && <p className="text-text-muted">This unknown-author bucket may contain multiple people. Its activity does not identify one contributor.</p>}
      {selected?.contributor.kind === 'unlinked_email' && <p className="text-text-muted">This author group is not a verified GitHub identity.</p>}
      {!selected && <ContributorSummary bundle={bundle} />}
      <Button type="button" size="sm" variant="secondary" onClick={() => setEvidence(current => !current)}>{evidence ? 'Back to summary' : 'View evidence'}</Button>
    </div>
    {evidence ? <Evidence bundle={bundle} facts={facts} observations={analysis.ruleFeedback.observations} /> : <>
      <Metrics facts={facts} overview={!selected} />
      <section className="space-y-2" aria-label="Workflow findings"><h4 className="font-semibold">Workflow findings</h4>
        {analysis.ruleFeedback.observations.some(item => item.kind !== 'limitation') ? <ul className="list-disc space-y-2 pl-5">{analysis.ruleFeedback.observations.filter(item => item.kind !== 'limitation').slice(0,3).map(item => <li key={item.id}>{item.text}</li>)}</ul> : <p className="text-text-muted">No workflow findings are supported by the collected evidence.</p>}
        <p className="text-xs text-text-muted">Rule-based observations · teacher review · no AI interpretation</p>
      </section>
      <Limitations bundle={bundle} facts={facts} />
      <section className="space-y-3" aria-label="Feedback preview"><h4 className="font-semibold">Feedback preview</h4>
        <FormField label="Report feedback" hint={`Preview for ${label}. Appends this preview to the Pika comment draft, preserving its existing text. Nothing is sent to the student.`}>
          <textarea value={feedback} onChange={event => editFeedback(event.target.value)} rows={7} maxLength={20000} className="min-h-control w-full resize-y rounded-control border border-border bg-surface px-3 py-2 text-text-default focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus" />
        </FormField>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => {void importFeedback()}} disabled={!canImport || busy || alreadyImported || !feedback.trim()}>{busy ? 'Adding to comment draft…' : alreadyImported ? 'Added to comment draft' : 'Add to comment draft'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => editFeedback(analysis.ruleFeedback.feedbackDraft)}>Restore rule draft</Button></div>
        {!canImport && !importError && <p className="text-text-muted">Feedback import is unavailable for this report or submission.</p>}
        {importError ? <p role="alert" className="text-danger">{importError}</p> : message?.text ? <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-danger' : 'text-text-muted'}>{message.text}</p> : null}
      </section>
    </>}
  </div>
}

function ContributorSummary({bundle}: {bundle: PublicRepositoryBundle}) {
  return <div className="space-y-2"><h4 className="font-semibold">Contributors</h4>
    {bundle.contributors.length ? <ul className="space-y-1 text-text-muted">{bundle.contributors.map(({contributor,analysis}) => <li key={contributor.id} className="break-words">{contributor.label} · {kindLabel(contributor)} · {analysis.facts.metrics.commits.value === null ? 'Commit count unavailable' : `${analysis.facts.metrics.commits.value} ${analysis.facts.metrics.commits.status === 'partial' ? 'observed commits (partial)' : 'included commits'}`}</li>)}</ul> : <p className="text-text-muted">No eligible contributors were identified. Check collection coverage before concluding there was no activity.</p>}
  </div>
}

function Metrics({facts,overview}: {facts: ScopeFacts; overview: boolean}) {
  const entries = [
    {label:overview ? 'Repository commits' : 'Contributor commits',metric:facts.metrics.commits,percent:false},
    {label:'Commit density',metric:facts.metrics.commitDensity,percent:false},
    {label:'Scheduled day coverage',metric:facts.metrics.scheduledDayCoverage,percent:true},
    {label:'Busiest day share',metric:facts.metrics.busiestDayShare,percent:true},
  ]
  return <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Report metrics">{entries.map(({label,metric,percent}) => <section key={label} className="min-w-0 space-y-1 rounded-lg bg-surface-2 p-3"><h4 className="text-xs font-medium text-text-muted">{label}</h4><p className="text-xl font-semibold tabular-nums">{metric.value === null ? 'Unavailable' : percent ? `${Math.round(metric.value * 100)}%` : Number(metric.value.toFixed(2)).toLocaleString('en-CA')}</p><p className="text-xs text-text-muted">{metric.status === 'partial' ? 'Partial evidence' : readable(metric.status)}{label === 'Commit density' ? ' · commits / scheduled project day' : ''}</p>{metric.reason && <p className="break-words text-xs text-text-muted">{metric.reason}</p>}{metric.numerator !== null && metric.denominator !== null && <p className="text-xs text-text-muted">{metric.numerator} / {metric.denominator}</p>}</section>)}</div>
}

function Limitations({bundle,facts}: {bundle: PublicRepositoryBundle; facts: ScopeFacts}) {
  const notes = [...facts.coverage.notes]
  if (facts.coverage.history !== 'complete') notes.unshift(`History collection is ${facts.coverage.history}; observed activity may be incomplete.`)
  if (facts.coverage.files !== 'complete') notes.push(`File evidence is ${facts.coverage.files}; missing cells are not verified zeros.`)
  if (bundle.context.baseline.status !== 'applied') notes.push('Starter history has not been reviewed; inherited changes may remain in counts.')
  if (!bundle.context.scheduledProjectDates?.length) notes.push('Project schedule is unavailable; density and scheduled-day coverage are unavailable.')
  return <section className="space-y-2" aria-label="Report limitations"><h4 className="font-semibold">Limitations</h4>{notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-text-muted">{[...new Set(notes)].map(note => <li key={note}>{note}</li>)}</ul>}<p className="text-xs text-text-muted">Commit time is not push time. Activity counts do not establish effort, attendance, understanding or AI authorship.</p></section>
}

function calendarDates(bundle: PublicRepositoryBundle) {
  const {period} = bundle.context
  const first = formatDayInZone(period.startAt,period.timezone)
  const last = formatDayInZone(new Date(Date.parse(period.endAt) - 1).toISOString(),period.timezone)
  const dates: string[] = []
  for (let instant = Date.parse(`${first}T12:00:00Z`); instant <= Date.parse(`${last}T12:00:00Z`); instant += 86400000) dates.push(new Date(instant).toISOString().slice(0,10))
  return dates
}

function ScrollTable({label,children}: {label: string; children: ReactNode}) {
  return <div role="region" aria-label={label} tabIndex={0} className={focusRegion}><DataTable density="compact" className="text-xs">{children}</DataTable></div>
}

function Evidence({bundle,facts,observations}: {bundle: PublicRepositoryBundle; facts: ScopeFacts; observations: PublicRepositoryBundle['overview']['ruleFeedback']['observations']}) {
  const {context} = bundle
  const dates = calendarDates(bundle)
  const timeline = new Map(facts.timeline.map(point => [point.date,point.commitCount]))
  const datedComplete = facts.metrics.commits.status === 'available' && facts.activity.undatedCommitCount === 0
  const maximum = Math.max(1,...facts.timeline.map(point => point.commitCount))
  return <div className="min-w-0 space-y-5">
    <section className="space-y-2" aria-label="Report source"><h4 className="font-semibold">Source and collection</h4><a className={linkStyle} href={context.repository.url} target="_blank" rel="noreferrer">{context.repository.url}</a><p className="break-words text-text-muted">{context.repository.branch} · {context.period.timezone}</p><p className="break-words text-text-muted">Period [start, end): {context.period.startAt} – {context.period.endAt}</p><a className={linkStyle} href={`${context.repository.url}/commit/${context.snapshot.sha}`} target="_blank" rel="noreferrer">Snapshot {context.snapshot.sha.slice(0,12)}</a><p className="text-text-muted">{readable(context.snapshot.kind)} · captured {context.snapshot.capturedAt}</p><p className="text-text-muted">History: {facts.coverage.history} · Files: {facts.coverage.files}</p>
      <details><summary className="min-h-control cursor-pointer py-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Applied exclusions</summary><div className="space-y-1 break-words text-text-muted"><p>Commit SHAs: {context.exclusions.commitShas.join(', ') || 'None'}</p><p>File prefixes: {context.exclusions.pathPrefixes.join(', ') || 'None'}</p><p>Bot logins: {context.exclusions.botLogins.join(', ') || 'None'}</p><p>Baseline: {readable(context.baseline.status)}{context.baseline.reference && ` · ${context.baseline.reference}`}</p></div></details>
    </section>
    <section className="space-y-2" aria-label="Commit timeline"><h4 className="font-semibold">Commit timeline</h4><p className="text-text-muted">Local author dates · {facts.activity.undatedCommitCount} undated commits. {datedComplete ? 'Zero means no included commit on that date.' : 'Gaps are unknown; observed counts may be incomplete.'}</p>
      <ScrollTable label="Scrollable daily commit timeline"><caption className="text-left text-text-muted">Observed commits by local date</caption><DataTableHead><DataTableRow><DataTableHeaderCell>Date</DataTableHeaderCell><DataTableHeaderCell>Commits</DataTableHeaderCell><DataTableHeaderCell>Observed activity</DataTableHeaderCell></DataTableRow></DataTableHead><DataTableBody>{dates.map(date => <DataTableRow key={date}><DataTableHeaderCell scope="row">{date}</DataTableHeaderCell><DataTableCell>{timeline.has(date) ? `${timeline.get(date)}${datedComplete ? '' : ' observed (partial)'}` : datedComplete ? '0' : 'Unknown'}</DataTableCell><DataTableCell>{timeline.has(date) || datedComplete ? <meter className="w-full" min={0} max={maximum} value={timeline.get(date) || 0} aria-label={`Observed commits on ${date}`} /> : 'Unknown'}</DataTableCell></DataTableRow>)}</DataTableBody></ScrollTable>
    </section>
    <FileHeatmap key={bundle.bundleRef} facts={facts} dates={dates} />
    <section className="space-y-2"><h4 className="font-semibold">Commit evidence</h4>{facts.commits.length ? <ScrollTable label="Scrollable commit evidence"><caption className="text-left text-text-muted">Commit evidence</caption><DataTableHead><DataTableRow><DataTableHeaderCell>Commit / author date</DataTableHeaderCell><DataTableHeaderCell>Message</DataTableHeaderCell><DataTableHeaderCell>Observed files</DataTableHeaderCell><DataTableHeaderCell>Observed + / −</DataTableHeaderCell></DataTableRow></DataTableHead><DataTableBody>{facts.commits.map(commit => <DataTableRow key={commit.sha}><DataTableCell><a className={linkStyle} href={commit.url} target="_blank" rel="noreferrer">{commit.sha.slice(0,7)}</a><p>{commit.authoredAt ? new Intl.DateTimeFormat('en-CA',{timeZone:context.period.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(commit.authoredAt)) : 'Author date unknown'}</p></DataTableCell><DataTableCell className="break-words whitespace-pre-wrap">{commit.message || '(empty message)'}</DataTableCell><DataTableCell>{commit.files.length}{facts.coverage.files !== 'complete' ? ' observed' : ''}</DataTableCell><DataTableCell>{commit.additions ?? '?'} / {commit.deletions ?? '?'}</DataTableCell></DataTableRow>)}</DataTableBody></ScrollTable> : <PageState compact kind="empty" title="No included commits observed" description="Check collection coverage, period and exclusions before drawing conclusions." />}</section>
    <section className="space-y-2"><h4 className="font-semibold">Workflow observations</h4>{observations.map(observation => <article key={observation.id} className="space-y-1 rounded-lg bg-surface-2 p-3"><p className="text-xs font-medium text-text-muted">{readable(observation.kind)}</p><p>{observation.text}</p><div className="flex flex-wrap gap-3">{observation.evidence.map((reference,index) => <a key={`${reference.commitSha}-${index}`} className={linkStyle} href={`${context.repository.url}/commit/${reference.commitSha}`} target="_blank" rel="noreferrer">{reference.commitSha.slice(0,7)}{reference.path && ` · ${reference.path}`}</a>)}</div></article>)}</section>
    <Limitations bundle={bundle} facts={facts} />
  </div>
}

function FileHeatmap({facts,dates}: {facts: ScopeFacts; dates: string[]}) {
  const [filter,setFilter] = useState('')
  const files = facts.heatmap.files.filter(path => path.toLowerCase().includes(filter.toLowerCase()))
  const dated = new Map(facts.timeline.flatMap(point => point.commitShas.map(sha => [sha,point.date] as const)))
  const cells = new Map<string,number>()
  for (const cell of facts.heatmap.cells) {
    const date = dated.get(cell.commitSha)
    if (date) {const key = `${cell.path}\0${date}`;cells.set(key,(cells.get(key) || 0) + cell.additions + cell.deletions)}
  }
  const complete = facts.heatmap.status === 'available' && facts.coverage.history === 'complete' && facts.coverage.files === 'complete' && facts.activity.undatedCommitCount === 0
  const maximum = Math.max(1,...cells.values())
  return <section className="min-w-0 space-y-2" aria-label="File activity"><h4 className="font-semibold">File activity</h4><p className="text-text-muted">Observed additions + deletions by file and local date; volume does not measure value. {complete ? 'A dash means no included change.' : 'Missing cells are unknown (?). Observed values may be incomplete.'} Undated changes cannot be assigned to a date.</p><FormField label="Filter file paths"><Input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter paths" /></FormField><p className="text-xs text-text-muted">Showing {Math.min(files.length,50)} of {files.length} matching paths. Darker cells show more observed line changes.</p>
    {files.length ? <ScrollTable label="Scrollable file activity"><caption className="text-left text-text-muted">Observed file changes by local date</caption><DataTableHead><DataTableRow><DataTableHeaderCell>File</DataTableHeaderCell>{dates.map(date => <DataTableHeaderCell key={date}>{date}</DataTableHeaderCell>)}</DataTableRow></DataTableHead><DataTableBody>{files.slice(0,50).map(path => <DataTableRow key={path}><DataTableHeaderCell scope="row" className="break-all">{path}</DataTableHeaderCell>{dates.map(date => {const value = cells.get(`${path}\0${date}`);return <DataTableCell key={date} className={value === undefined ? 'bg-surface-3 text-text-muted' : value > maximum * 2 / 3 ? 'bg-primary-solid text-text-inverse' : value > maximum / 3 ? 'bg-info-bg text-text-default' : 'bg-surface-hover text-text-default'}>{value ?? (complete ? '—' : '?')}</DataTableCell>})}</DataTableRow>)}</DataTableBody></ScrollTable> : <PageState compact kind="empty" title="No matching file evidence" description="Missing or filtered evidence does not establish that no files changed." />}
  </section>
}
