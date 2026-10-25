import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssignmentRepositoryReport } from '@/components/assignment-workspace/AssignmentRepositoryReport'
import { calculateScopeFacts } from '@/lib/contracts/repolight/report/calculations'
import { publicRepositoryBundleSchema, type PublicRepositoryBundle, type ScopeAnalysis } from '@/lib/contracts/repolight/report/bundle-contract'

function fixture(partial = false, matched = false): PublicRepositoryBundle {
  const context: PublicRepositoryBundle['context'] = {
    metricsVersion:'2.0.0',repository:{url:'https://github.com/fixture/project',branch:'main',visibility:'public'},
    snapshot:{sha:'f'.repeat(40),capturedAt:'2026-10-24T12:00:00Z',kind:'analysis_time'},
    period:{startAt:'2026-10-20T04:00:00Z',endAt:'2026-10-23T04:00:00Z',timezone:'America/Toronto'},
    scheduledProjectDates:['2026-10-20','2026-10-21','2026-10-22'],baseline:{status:'applied',reference:'fixture-baseline'},exclusions:{commitShas:[],botLogins:[],pathPrefixes:[]},
  }
  const coverage: PublicRepositoryBundle['collectionCoverage'] = {history:partial ? 'partial' : 'complete',files:partial ? 'partial' : 'complete',notes:partial ? ['Fixture collection is incomplete.'] : []}
  const descriptors: PublicRepositoryBundle['contributors'][number]['contributor'][] = [
    {id:'alice',kind:'github_account',githubLogin:'alice',label:'@alice',accountType:'user'},
    {id:'bot',kind:'github_account',githubLogin:'helper-bot',label:'@helper-bot',accountType:'bot'},
    {id:'unknown',kind:'unknown_author',githubLogin:null,label:'Unknown authors',accountType:'unknown'},
    {id:'unlinked',kind:'unlinked_email',githubLogin:null,label:'Unlinked author 1',accountType:'unknown'},
  ]
  const commits = descriptors.map((descriptor,index)=>({sha:String(index + 1).repeat(40),message:`Fixture change ${index + 1}`,authoredAt:partial && index === 2 ? null : `2026-10-${index % 2 ? '22' : '20'}T14:00:00Z`,githubLogin:descriptor.githubLogin,url:`${context.repository.url}/commit/${String(index + 1).repeat(40)}`,additions:3,deletions:1,files:[{path:`src/File${index}.java`,status:'modified',additions:3,deletions:1}]}))
  function analysis(scope: ScopeAnalysis['scope'], evidence: typeof commits): ScopeAnalysis {
    const facts = calculateScopeFacts({...context,repositoryUrl:context.repository.url,branch:'main',coverage,events:[]},evidence)
    const name = scope.kind === 'repository' ? 'repository' : scope.contributorId
    return {scope,facts,ruleFeedback:{rulesVersion:'1.1.0',observations:[{id:'activity',ruleId:'activity',kind:'strength',text:`Observed ${name} checkpoints.`,evidence:[{commitSha:evidence[0].sha,path:null}]}],summary:{activeDays:facts.timeline.length,genericMessageCount:0,messageCount:evidence.length,longestScheduledGap:null},feedbackDraft:`Original ${name} draft.`}}
  }
  return publicRepositoryBundleSchema.parse({schemaVersion:'1.0',bundleRef:'fixture-report',context,collectionCoverage:coverage,
    selection:matched ? {status:'matched',requestedGithubLogin:'alice',contributorId:'alice',notice:null} : {status:'not_requested',requestedGithubLogin:null,contributorId:null,notice:'No username supplied. Showing the repository overview and all contributors.'},
    overview:analysis({kind:'repository'},commits),contributors:descriptors.map((contributor,index)=>({contributor,analysis:analysis({kind:'contributor',contributorId:contributor.id},[commits[index]])})),
  })
}
const text = () => (screen.getByLabelText('Report feedback') as HTMLTextAreaElement).value
const choose = (scope: string) => fireEvent.change(screen.getByLabelText('Report view'),{target:{value:scope}})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('AssignmentRepositoryReport',()=>{
  it('starts on overview, exposes contributor kinds and switches local scopes without collection',()=>{
    const fetchMock = vi.fn();vi.stubGlobal('fetch',fetchMock)
    render(<AssignmentRepositoryReport bundle={fixture()} canImport onImportFeedback={vi.fn()} />)
    expect(screen.getByRole('heading',{name:'Repository overview'})).toBeInTheDocument()
    expect(screen.getByText(/No username supplied/)).toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'Repository commits'})).toBeInTheDocument()
    expect(screen.getByRole('option',{name:'@helper-bot · Bot account'})).toBeInTheDocument()
    expect(screen.getByRole('option',{name:'Unlinked author 1 · Unlinked author'})).toBeInTheDocument()
    choose('contributor:alice')
    expect(screen.getByRole('heading',{name:'@alice'})).toBeInTheDocument()
    expect(screen.queryByText(/No username supplied/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading',{name:'Contributor commits'})).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('table',{name:'Commit evidence'})).not.toBeInTheDocument()
  })

  it('opens a matching username and keeps editable drafts separate through scope and evidence changes',()=>{
    render(<AssignmentRepositoryReport bundle={fixture(false,true)} canImport onImportFeedback={vi.fn()} />)
    expect(text()).toBe('Original alice draft.')
    fireEvent.change(screen.getByLabelText('Report feedback'),{target:{value:'Teacher alice draft.'}})
    choose('repository')
    fireEvent.change(screen.getByLabelText('Report feedback'),{target:{value:'Teacher overview draft.'}})
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    choose('contributor:alice')
    fireEvent.click(screen.getByRole('button',{name:'Back to summary'}))
    expect(text()).toBe('Teacher alice draft.')
    fireEvent.click(screen.getByRole('button',{name:'Restore rule draft'}))
    expect(text()).toBe('Original alice draft.')
    choose('repository')
    expect(text()).toBe('Teacher overview draft.')
  })

  it('imports only after an explicit action with the displayed scope and exact edited preview',async()=>{
    const onImportFeedback = vi.fn().mockResolvedValue(undefined)
    const bundle = fixture(false,true)
    render(<AssignmentRepositoryReport bundle={bundle} canImport onImportFeedback={onImportFeedback} />)
    fireEvent.change(screen.getByLabelText('Report feedback'),{target:{value:'Reviewed text to append.'}})
    expect(onImportFeedback).not.toHaveBeenCalled()
    expect(screen.getByText(/Appends this preview to the Pika comment draft/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Add to comment draft'}))
    await screen.findByText('Added to the comment draft. Review it in Pika before sending.')
    expect(onImportFeedback).toHaveBeenCalledExactlyOnceWith('contributor:alice','Reviewed text to append.')
    expect(bundle.contributors[0].analysis.ruleFeedback.feedbackDraft).toBe('Original alice draft.')
  })

  it('preserves text after import errors and honors permission, stale-source and pending guards',async()=>{
    const onImportFeedback = vi.fn().mockRejectedValue(new Error('Submission changed. Reanalyze before importing.'))
    const bundle = fixture()
    const {rerender} = render(<AssignmentRepositoryReport bundle={bundle} canImport onImportFeedback={onImportFeedback} />)
    fireEvent.change(screen.getByLabelText('Report feedback'),{target:{value:'Keep my reviewed text.'}})
    fireEvent.click(screen.getByRole('button',{name:'Add to comment draft'}))
    await screen.findByRole('alert')
    expect(text()).toBe('Keep my reviewed text.')
    rerender(<AssignmentRepositoryReport bundle={bundle} canImport={false} importError="This report belongs to an older submission." onImportFeedback={onImportFeedback} />)
    expect(screen.getByRole('button',{name:'Add to comment draft'})).toBeDisabled()
    expect(screen.getByText('This report belongs to an older submission.')).toBeInTheDocument()
    rerender(<AssignmentRepositoryReport bundle={bundle} canImport importing onImportFeedback={onImportFeedback} />)
    expect(screen.getByRole('button',{name:'Adding to comment draft…'})).toBeDisabled()
    expect(onImportFeedback).toHaveBeenCalledTimes(1)
  })

  it('keeps unknown-author and incomplete-evidence caveats in summary and evidence',()=>{
    render(<AssignmentRepositoryReport bundle={fixture(true)} canImport={false} onImportFeedback={vi.fn()} />)
    choose('contributor:unknown')
    expect(screen.getByText(/unknown-author bucket may contain multiple people/)).toBeInTheDocument()
    expect(screen.getByText(/History collection is partial/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    expect(screen.getByText(/unknown-author bucket may contain multiple people/)).toBeInTheDocument()
    expect(screen.getByText('Author date unknown')).toBeInTheDocument()
    expect(screen.getByText(/Missing cells are unknown/)).toBeInTheDocument()
    expect(screen.getByText(/Commit time is not push time/)).toBeInTheDocument()
    choose('repository')
    const timeline = screen.getByRole('table',{name:'Observed commits by local date'})
    const gap = within(timeline).getByText('2026-10-21').closest('tr')!
    expect((gap as HTMLTableRowElement).cells[1].textContent).toBe('Unknown')
    const heatmap = screen.getByRole('table',{name:'Observed file changes by local date'})
    expect(within(heatmap).getAllByText('?').length).toBeGreaterThan(0)
    expect(screen.getByRole('link',{name:/Snapshot/})).toHaveAttribute('href',`https://github.com/fixture/project/commit/${'f'.repeat(40)}`)
  })

  it('uses zero only for verified complete gaps and resets drafts when a different bundle is supplied',()=>{
    const bundle = fixture()
    const {rerender} = render(<AssignmentRepositoryReport bundle={bundle} canImport onImportFeedback={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Report feedback'),{target:{value:'Old local draft.'}})
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    const timeline = screen.getByRole('table',{name:'Observed commits by local date'})
    expect(within(within(timeline).getByText('2026-10-21').closest('tr')!).getByText('0')).toBeInTheDocument()
    const next = fixture(false,true);next.bundleRef = 'another-fixture-report'
    rerender(<AssignmentRepositoryReport bundle={next} canImport onImportFeedback={vi.fn()} />)
    expect(screen.getByRole('heading',{name:'@alice'})).toBeInTheDocument()
    expect(text()).toBe('Original alice draft.')
  })

  it('keeps scope-specific import messages from being presented as another scope result',async()=>{
    let finish: (()=>void) | undefined
    const onImportFeedback = vi.fn(()=>new Promise<void>(resolve=>{finish = resolve}))
    render(<AssignmentRepositoryReport bundle={fixture()} canImport onImportFeedback={onImportFeedback} />)
    fireEvent.click(screen.getByRole('button',{name:'Add to comment draft'}))
    choose('contributor:alice')
    await act(async()=>{finish!()})
    expect(screen.queryByText('Added to the comment draft. Review it in Pika before sending.')).not.toBeInTheDocument()
    expect(text()).toBe('Original alice draft.')
  })
  it('preserves keyboard focus across local view changes and exposes named scroll regions',async()=>{
    const user = userEvent.setup()
    render(<AssignmentRepositoryReport bundle={fixture()} canImport onImportFeedback={vi.fn()} />)
    await user.tab()
    expect(screen.getByRole('combobox',{name:'Report view'})).toHaveFocus()
    await user.selectOptions(screen.getByRole('combobox',{name:'Report view'}),'contributor:alice')
    expect(screen.getByRole('combobox',{name:'Report view'})).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button',{name:'View evidence'})).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button',{name:'Back to summary'})).toHaveFocus()
    expect(screen.getByRole('region',{name:'Scrollable daily commit timeline'})).toHaveAttribute('tabindex','0')
    expect(screen.getByRole('region',{name:'Scrollable file activity'})).toHaveAttribute('tabindex','0')
  })

  it('keeps unavailable history and day metrics unavailable instead of asserting zeros',()=>{
    const bundle = fixture()
    bundle.collectionCoverage = {history:'unavailable',files:'unavailable',notes:[]}
    bundle.overview.facts = calculateScopeFacts({...bundle.context,repositoryUrl:bundle.context.repository.url,branch:'main',coverage:bundle.collectionCoverage,events:[]},[])
    bundle.overview.ruleFeedback.observations = []
    bundle.overview.ruleFeedback.feedbackDraft = 'Insufficient evidence.'
    bundle.overview.ruleFeedback.summary = {activeDays:0,genericMessageCount:0,messageCount:0,longestScheduledGap:null}
    bundle.contributors = []
    render(<AssignmentRepositoryReport bundle={publicRepositoryBundleSchema.parse(bundle)} canImport={false} onImportFeedback={vi.fn()} />)
    expect(screen.getByRole('heading',{name:'Repository commits'}).parentElement?.querySelector('p')?.textContent).toBe('Unavailable')
    expect(screen.getByText(/History collection is unavailable/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    const table = screen.getByRole('table',{name:'Observed commits by local date'}) as HTMLTableElement
    expect(Array.from(table.tBodies[0].rows).map(row=>row.cells[1].textContent)).toEqual(['Unknown','Unknown','Unknown'])
  })

})
