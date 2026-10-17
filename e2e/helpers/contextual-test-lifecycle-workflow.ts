/** Ordinary frozen-app actions. Importing this file never runs the rehearsal. */
import assert from 'node:assert/strict'
import { expect, type Page, type Response } from '@playwright/test'
import { openVerticalMemberAccess, publishVerticalTest, selectVerticalMemberResponse, type VerticalTestRuntime } from './contextual-test-vertical-workflow'
import { assertVerticalLearnerDisclosure } from './contextual-test-grade-return-workflow'
import { assertLifecycleAttempt, assertLifecycleRecovery, assertLifecycleGraphEquality, lifecycleReference, lifecycleText, lifecycleScreens, lifecycleReorderStages,
  type LifecycleActor, type LifecycleAttempt, type LifecycleExchange, type LifecycleResult, type LifecycleResults } from './contextual-test-lifecycle-contract'
export type LifecycleRuntime = Omit<VerticalTestRuntime,'withActor'> & {
  withActor(actor: LifecycleActor, callback: (page: Page) => Promise<void>): Promise<void>
}
const mainTitle = 'Contextual lifecycle Test', scratchTitle = 'Contextual lifecycle scratch'
export async function reorderLifecycleTests(page: Page,onStage:(stage:typeof lifecycleReorderStages[number])=>void=()=>{}): Promise<void> {
  const handle = page.getByRole('button',{name:`Drag to reorder ${mainTitle}`,exact:true})
  onStage('reorder-focus'); await handle.focus()
  onStage('reorder-pickup'); await handle.press('Space')
  onStage('reorder-move'); await handle.press('ArrowUp')
  onStage('reorder-drop'); await handle.press('Space')
}
function waitFor(page: Page, method: string, path: string) {
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method)
  void pending.catch(() => {}); return pending
}
function markdown(title: string) {
  return `# Test\nTitle: ${title}\nShow Results: false\n\n## Questions\n### Question 1\nType: multiple_choice\nPoints: 5\nPrompt:\nChoose the second option.\nOptions:\n- Alpha\n- Beta\nCorrect Option: 2\n\n### Question 2\nType: open_response\nPoints: 5\nMax Chars: 2000\nPrompt:\nExplain your reasoning.\nAnswer Key:\nA reasoned response\nSample Solution:\nA private solution\n`
}
export async function runContextualTestLifecycleWorkflow(r: LifecycleRuntime): Promise<LifecycleResult> {
  r.check(); const c = r.plan.classrooms.classA.id, ownerId = r.plan.actors.ownerTeacher.id
  const classUrl = `${r.plan.appOrigin}/classrooms/${c}?tab=tests`, exchanges: LifecycleExchange[] = []
  let stage = 'author', main = '', scratch = '', questions: [string,string] = ['', '']
  const actorPages = new WeakMap<Page,LifecycleActor>()
  const withActor = (actor: LifecycleActor,callback:(page:Page)=>Promise<void>) => r.withActor(actor,async page=>{actorPages.set(page,actor);await callback(page)})
  let recovery!: LifecycleResult['recovery'], retained!: LifecycleResult['retained'], archive!: LifecycleResult['archive'],disclosure!:LifecycleResult['disclosure']
  async function capture(label: typeof lifecycleScreens[number]['label'],page: Page) {
    const scene = lifecycleScreens.find(row=>row.label===label)!
    await page.setViewportSize(scene.viewport==='mobile'?{width:390,height:844}:{width:1440,height:900})
    await page.emulateMedia({colorScheme:scene.theme}); await page.evaluate(theme=>localStorage.setItem('theme',theme),scene.theme)
    if(label==='lifecycle-standalone-preview') await r.navigate(page,`${r.plan.appOrigin}/classrooms/${c}/tests/${main}/preview`)
    else {
      await r.navigate(page,classUrl)
      if(label==='lifecycle-embedded-preview') await page.getByRole('button',{name:`Preview ${mainTitle}`,exact:true}).click()
      else await page.getByRole('button',{name:scene.actor==='memberStudent'?new RegExp(mainTitle):label==='lifecycle-reset'?scratchTitle:mainTitle,exact:scene.actor==='ownerTeacher'}).first().click()
    }
    const maximize = page.getByRole('button',{name:'Maximize Window',exact:true})
    if(await maximize.isVisible())await maximize.click()
    if(label==='lifecycle-embedded-preview'||label==='lifecycle-standalone-preview') {
      await page.getByRole('button',{name:'Synthetic reference',exact:true}).click()
      await expect(page.getByText(lifecycleReference,{exact:true})).toBeVisible()
    }
    await r.snapshot(label,page)
  }
  async function record(page: Page, label: string, pending: Promise<Response>, status = 200) {
    const response = await pending; assert.equal(response.status(), status)
    const result = await r.response(page,response)
    exchanges.push({ label, actor:actorPages.get(page)!, via: 'screen', method: response.request().method(), path: new URL(response.url()).pathname,
      status, request: response.request().postDataJSON() ?? null, response: result }); return result
  }
  async function probe(page: Page, label: string, method: string, path: string, body: unknown, status: number,
    via: LifecycleExchange['via'] = 'denied-probe') {
    const result = await r.api(page,method,path,body,status)
    exchanges.push({ label,actor:actorPages.get(page)!,via,method,path,status,request: body ?? null,response: result }); return result
  }
  const results = (page: Page, id = main) => r.api<LifecycleResults>(page,'GET',`/api/teacher/tests/${id}/results`)
  const attempt = async (page: Page, id = main) => (await r.api<{attempt:LifecycleAttempt}>(page,'GET',`/api/student/tests/${id}/attempt`)).attempt
  async function workspace(page: Page, title = mainTitle) {
    await r.navigate(page,classUrl); await page.getByRole('button',{name:title,exact:true}).click()
  }
  async function select(page: Page, ids: string[]) {
    for (const id of ids) await page.getByTestId(`test-grading-student-row-${id}`).getByRole('checkbox').check()
    await page.getByRole('button',{name:`Student actions for ${ids.length} selected`,exact:true}).click()
  }
  async function create(page: Page, title: string, reference: boolean) {
    stage='owner-create'
    await r.navigate(page,classUrl)
    const ack = waitFor(page,'POST','/api/teacher/tests')
    await page.getByRole('button',{name:'Create test',exact:true}).click()
    const response = await ack; assert.equal(response.status(),201)
    const made = await r.response<{test:{id:string;classroom_id:string}}>(page,response)
    assert.equal(made.test.classroom_id,c); const id = made.test.id
    const editor = page.getByRole('dialog',{name:'Edit test',exact:true})
    stage='owner-author'
    await editor.getByRole('button',{name:'Markdown',exact:true}).click()
    await editor.getByTestId('test-markdown-editor').fill(markdown(title))
    await editor.getByRole('button',{name:'Apply Markdown',exact:true}).click()
    await expect(editor.getByTestId('teacher-test-authoring-save-status')).toHaveText('Test saved')
    if (reference) {
      stage='owner-reference'
      await editor.getByRole('button',{name:'Add reference',exact:true}).click()
      await page.getByRole('menuitem',{name:'Markdown text',exact:true}).click()
      await page.getByLabel('Document title',{exact:true}).fill('Synthetic reference')
      await page.getByLabel('Document text',{exact:true}).fill(lifecycleReference)
      const saved = waitFor(page,'PATCH',`/api/teacher/tests/${id}`)
      await page.getByRole('button',{name:'Add text document',exact:true}).click(); assert.equal((await saved).status(),200)
    }
    await editor.getByRole('button',{name:'Close test editor',exact:true}).click()
    stage='owner-save-readback'
    await workspace(page,title)
    await page.getByTestId('test-workspace-trailing-actions').getByRole('button',{name:'More actions',exact:true}).click()
    await page.getByRole('menuitem',{name:'Edit Markdown',exact:true}).click()
    const savedMarkdown = await editor.getByTestId('test-markdown-editor').inputValue()
    assert(savedMarkdown.includes(`Title: ${title}`) && savedMarkdown.includes('Explain your reasoning.') && savedMarkdown.includes('A private solution'))
    const detail = await r.api<{test:{title:string;documents:{source:string;content:string}[]}}>(page,'GET',`/api/teacher/tests/${id}`)
    assert.equal(detail.test.title,title)
    assert.equal(detail.test.documents.length,reference?1:0)
    if(reference)assert(detail.test.documents[0].source==='text' && detail.test.documents[0].content===lifecycleReference)
    const published = waitFor(page,'POST',`/api/teacher/tests/${id}/publish`)
    stage='owner-publish'
    await publishVerticalTest(r,page,editor,id)
    await record(page,reference?'publish-main':'publish-scratch',published)
    return id
  }
  async function start(page: Page, title: string) {
    await r.navigate(page,classUrl); await page.getByRole('button',{name:new RegExp(title)}).first().click()
    await page.getByRole('button',{name:'Start the Test',exact:true}).click()
    await page.getByRole('dialog',{name:'Start this test?',exact:true}).getByRole('button',{name:'Start test',exact:true}).click()
    await expect(page.getByTestId('student-test-split-container')).toBeVisible()
    await expect(page.getByTestId('exam-interaction-blocker')).toBeHidden()
  }
  async function fill(page: Page, actor: string) {
    await page.getByRole('textbox',{name:/Response for question/}).fill(lifecycleText(actor))
    await page.getByRole('radio',{name:'Beta',exact:true}).check()
    await expect(page.getByTestId('student-test-autosave-status')).toHaveText('Saved')
  }
  async function submit(page: Page, id: string, label: string) {
    const ack = waitFor(page,'POST',`/api/student/tests/${id}/respond`)
    await page.getByRole('button',{name:'Submit',exact:true}).click()
    await page.getByRole('dialog',{name:'Submit your answers?',exact:true}).getByRole('button',{name:'Submit',exact:true}).click()
    await record(page,label,ack,201)
  }
  async function access(owner: Page, id: string, title: string, state: 'open'|'closed', ids: string[]) {
    stage='owner-access-workspace'
    await workspace(owner,title)
    for (const student of ids) {
      const row = owner.getByTestId(`test-grading-student-row-${student}`)
      if (state === 'open') {
        stage=student===r.plan.actors.memberStudent.id?'owner-open-student':'owner-open-teacher'
        await openVerticalMemberAccess(r,owner,row,id)
      }
      else {
        stage='owner-close-member'
        const ack = waitFor(owner,'POST',`/api/teacher/tests/${id}/student-access`)
        await row.getByRole('switch',{name:/Close access for/}).click(); assert.equal((await ack).status(),200)
      }
    }
  }
  try {
    await withActor('ownerTeacher',async owner => {
      main = await create(owner,mainTitle,true); scratch = await create(owner,scratchTitle,false)
      // Unpublish is available only before the irreversible first-attempt marker.
      await workspace(owner,scratchTitle)
      await owner.getByRole('button',{name:/^Test date:/}).click()
      await owner.getByRole('menu',{name:'Test publication',exact:true}).getByRole('menuitem',{name:'Unpublish',exact:true}).click()
      let initialAck=waitFor(owner,'POST',`/api/teacher/tests/${scratch}/unpublish`)
      await owner.getByRole('dialog',{name:'Return test to draft?',exact:true}).getByRole('button',{name:'Return to draft',exact:true}).click()
      await record(owner,'unpublish-scratch',initialAck)
      await workspace(owner,scratchTitle)
      initialAck=waitFor(owner,'POST',`/api/teacher/tests/${scratch}/publish`)
      await publishVerticalTest(r,owner,owner.getByTestId('test-workspace-actionbar-center'),scratch)
      await record(owner,'republish-scratch',initialAck)
      const graph = await results(owner), mc = graph.questions.find(q=>q.question_type==='multiple_choice')!, open = graph.questions.find(q=>q.question_type==='open_response')!
      questions = [mc.id,open.id]
      stage = 'previews'; await r.navigate(owner,classUrl)
      await owner.getByRole('button',{name:`Preview ${mainTitle}`,exact:true}).click()
      await expect(owner.getByRole('region',{name:'Teacher test preview',exact:true})).toBeVisible()
      // Persisted preference is applied on the next document mount; reopen the embedded preview afterwards.
      await capture('lifecycle-embedded-preview',owner)
      await owner.getByRole('button',{name:'Close Preview',exact:true}).click()
      const standalone = await owner.context().newPage()
      try {
        await r.navigate(standalone,`${r.plan.appOrigin}/classrooms/${c}/tests/${main}/preview`)
        const maximize = standalone.getByRole('button',{name:'Maximize Window',exact:true})
        if (await maximize.isVisible()) await maximize.click()
        await expect(standalone.getByRole('region',{name:'Teacher test preview',exact:true})).toBeVisible()
        await capture('lifecycle-standalone-preview',standalone)
      } finally { await standalone.close() }
      stage = 'reorder'; await r.navigate(owner,classUrl)
      stage='reorder-open-menu'
      await owner.getByRole('button',{name:'More actions',exact:true}).click()
      stage='reorder-enable-edit'
      await owner.getByRole('menuitemcheckbox',{name:'Edit Tests',exact:true}).click()
      const reorder = waitFor(owner,'POST','/api/teacher/tests/reorder/atomic')
      await reorderLifecycleTests(owner,next=>{stage=next})
      stage='reorder-ack'
      await record(owner,'reorder',reorder)
      const members = [r.plan.actors.memberStudent.id,r.plan.actors.memberTeacher.id]
      await access(owner,main,mainTitle,'open',members)
      await withActor('memberStudent',async student => withActor('memberTeacher',async teacher => {
        stage = 'recovery'; await start(student,mainTitle); await fill(student,'memberStudent')
        const before = await attempt(student); assertLifecycleAttempt(before,main,members[0],questions,lifecycleText('memberStudent'),false)
        // A real document navigation discards the mounted editor and reloads server data.
        await start(student,mainTitle)
        await expect(student.getByRole('textbox',{name:/Response for question/})).toHaveValue(lifecycleText('memberStudent'))
        const after = await attempt(student); assertLifecycleRecovery(before,after); recovery = {before,after}
        await student.setViewportSize({width:390,height:844}); await r.snapshot('lifecycle-learner-recovery',student)
        await student.setViewportSize({width:1440,height:900})
        await submit(student,main,'submit-memberStudent')
        await capture('lifecycle-learner-submitted',student)
        await start(teacher,mainTitle); await fill(teacher,'memberTeacher'); await submit(teacher,main,'submit-memberTeacher')
        await access(owner,main,mainTitle,'closed',members)
        stage = 'grade-conflict'
        await withActor('ownerTeacherPeer',async peer => {
          await workspace(peer); await selectVerticalMemberResponse(peer.getByTestId(`test-grading-student-row-${members[0]}`))
          const initial = (await results(peer)).students.find(s=>s.student_id===members[0])!.answers[open.id]
          const score = peer.getByRole('spinbutton',{name:'Q2 score',exact:true}), feedback = peer.getByPlaceholder('Leave a comment...',{exact:true})
          await expect(score).toHaveValue('')
          await probe(owner,'grade-perturbation','PATCH',`/api/teacher/tests/${main}/students/${members[0]}/grades`,
            {grades:[{question_id:open.id,response_id:initial.response_id,expected_response_revision:initial.response_revision,score:2,feedback:'Concurrent owner session'}]},200,'conflict-perturbation')
          const responses: Response[] = [], listener = (response: Response) => {
            if (new URL(response.url()).pathname===`/api/teacher/tests/${main}/students/${members[0]}/grades` && response.request().method()==='PATCH') responses.push(response)
          }
          peer.on('response',listener)
          try {
            const failed = waitFor(peer,'PATCH',`/api/teacher/tests/${main}/students/${members[0]}/grades`)
            await feedback.fill('Lifecycle manual feedback'); await score.fill('4'); await score.press('Tab')
            await record(peer,'grade-conflict',failed,409)
            await expect(peer.getByTestId('teacher-test-grading-save-status')).toHaveText('Grades saved')
            assert.equal(responses.length,2); await record(peer,'grade-retry',Promise.resolve(responses[1]))
            assert.equal(responses[1].request().postDataJSON().grades[0].expected_response_revision,initial.response_revision+1)
          } finally { peer.off('response',listener) }
        })
        stage = 'return-and-clear'; await workspace(owner); await select(owner,[members[0]])
        await owner.getByRole('menuitem',{name:'Return',exact:true}).click()
        let ack = waitFor(owner,'POST',`/api/teacher/tests/${main}/return`)
        await owner.getByRole('dialog',{name:'Return test work to 1 selected student(s)?',exact:true}).getByRole('button',{name:'Return',exact:true}).click()
        await record(owner,'return',ack)
        disclosure={returned:await r.api(student,'GET',`/api/student/tests/${main}/results`),retracted:null}
        await capture('lifecycle-learner-returned',student)
        await expect(student.getByText('Lifecycle manual feedback',{exact:true})).toBeVisible()
        await workspace(owner); await selectVerticalMemberResponse(owner.getByTestId(`test-grading-student-row-${members[0]}`))
        const score = owner.getByRole('spinbutton',{name:'Q2 score',exact:true}), feedback = owner.getByPlaceholder('Leave a comment...',{exact:true})
        await expect(score).toHaveValue('4')
        ack = waitFor(owner,'PATCH',`/api/teacher/tests/${main}/students/${members[0]}/grades`)
        await score.fill(''); await feedback.fill(''); await score.press('Tab')
        await record(owner,'clear-grade',ack); await expect(owner.getByTestId('teacher-test-grading-save-status')).toHaveText('Grades saved')
        disclosure.retracted=await r.api(student,'GET',`/api/student/tests/${main}`)
        assertVerticalLearnerDisclosure(disclosure.retracted,false,main)
        await capture('lifecycle-learner-retracted',student)
        await expect(student.getByText('Lifecycle manual feedback',{exact:true})).toBeHidden()
        await r.api(student,'GET',`/api/student/tests/${main}/results`,undefined,403)
        stage = 'unpublish-refusal'; await workspace(owner)
        await owner.getByRole('button',{name:/^Test date:/}).click()
        await expect(owner.getByRole('menu',{name:'Test publication',exact:true}).getByRole('menuitem',{name:'Unpublish',exact:true})).toBeDisabled()
        await owner.keyboard.press('Escape')
        await probe(owner,'unpublish-refused','POST',`/api/teacher/tests/${main}/unpublish`,{},409)
        stage = 'resets'; await access(owner,scratch,scratchTitle,'open',members)
        await start(student,scratchTitle); await fill(student,'memberStudent'); await submit(student,scratch,'scratch-single-submit')
        await access(owner,scratch,scratchTitle,'closed',members)
        await select(owner,[members[0]]); await owner.getByRole('menuitem',{name:'Unsubmit',exact:true}).click()
        ack = waitFor(owner,'POST',`/api/teacher/tests/${scratch}/unsubmit`)
        await owner.getByRole('dialog',{name:'Mark 1 selected attempt unsubmitted?',exact:true}).getByRole('button',{name:'Mark Unsubmitted',exact:true}).click()
        await record(owner,'unsubmit',ack)
        async function reset(ids: string[],label: string) {
          await workspace(owner,scratchTitle); await select(owner,ids); await owner.getByRole('menuitem',{name:'Delete Work',exact:true}).click()
          const pending = waitFor(owner,'POST',`/api/teacher/tests/${scratch}/students/attempts/bulk-delete`)
          await owner.getByRole('dialog',{name:`Delete ${ids.length} selected test work item${ids.length===1?'':'s'}?`,exact:true}).getByRole('button',{name:'Delete Work',exact:true}).click()
          await record(owner,label,pending)
          const fresh = await results(owner,scratch)
          for (const id of ids) assert.deepEqual(fresh.students.find(s=>s.student_id===id)!.answers,{})
        }
        await reset([members[0]],'reset-one'); await access(owner,scratch,scratchTitle,'open',members)
        await start(student,scratchTitle); await fill(student,'memberStudent'); await submit(student,scratch,'scratch-submit-memberStudent')
        await start(teacher,scratchTitle); await fill(teacher,'memberTeacher'); await submit(teacher,scratch,'scratch-submit-memberTeacher')
        await access(owner,scratch,scratchTitle,'closed',members); await reset(members,'reset-many')
        await capture('lifecycle-reset',owner)
        await owner.setViewportSize({width:1440,height:900})
        await workspace(owner,scratchTitle)
        await owner.getByTestId('test-workspace-trailing-actions').getByRole('button',{name:'More actions',exact:true}).click()
        await owner.getByRole('menuitem',{name:'Delete Test',exact:true}).click()
        ack = waitFor(owner,'DELETE',`/api/teacher/tests/${scratch}`)
        await owner.getByRole('dialog',{name:'Delete test?',exact:true}).getByRole('button',{name:'Delete',exact:true}).click(); await record(owner,'delete-scratch',ack)
        stage = 'permissions'
        await probe(owner,'self-owner','POST',`/api/student/tests/${main}/start`,{},403)
        await probe(owner,'foreign-parent','PATCH',`/api/teacher/tests/${r.plan.retiredTestIds[1]}`,{title:'Forbidden'},403)
        await probe(owner,'foreign-reorder','POST','/api/teacher/tests/reorder/atomic',{classroom_id:c,test_ids:[main,r.plan.retiredTestIds[1]]},409)
        await probe(teacher,'member-owner','GET',`/api/teacher/tests/${main}/results`,undefined,403)
        await withActor('nonmember',async page=>{
          await probe(page,'nonmember-read','GET',`/api/student/tests/${main}`,undefined,403)
          await probe(page,'nonmember-start','POST',`/api/student/tests/${main}/start`,{},403)
        })
        retained = {attempts:[await attempt(student),await attempt(teacher)],results:await results(owner),history:[
          await r.api(student,'GET',`/api/student/tests/${main}/history`),await r.api(teacher,'GET',`/api/student/tests/${main}/history`)]}
        for (const [i,actor] of ['memberStudent','memberTeacher'].entries()) assertLifecycleAttempt(retained.attempts[i],main,members[i],questions,lifecycleText(actor),true)
        const roster = r.plan.lifecycleRoster; assert(roster)
        await probe(owner,'remove-member','POST',`/api/teacher/classrooms/${c}/roster/remove`,{roster_ids:[roster.id]},200,'permission-fixture')
        const forbidden = {expected_revision:retained.attempts[0].draft_revision,responses:retained.attempts[0].responses}
        await probe(student,'revoked-cached-read','GET',`/api/student/tests/${main}/attempt`,undefined,403)
        await probe(student,'revoked-cached-save','PATCH',`/api/student/tests/${main}/attempt`,forbidden,403)
        await probe(student,'revoked-cached-submit','POST',`/api/student/tests/${main}/respond`,forbidden,403)
        await withActor('memberStudent',async fresh=>{
          await probe(fresh,'revoked-fresh-read','GET',`/api/student/tests/${main}`,undefined,403)
          await probe(fresh,'revoked-fresh-start','POST',`/api/student/tests/${main}/start`,{},403)
          await probe(fresh,'rejoin-refused','POST','/api/student/classrooms/join',{classCode:r.plan.classrooms.classA.classCode,firstName:'Synthetic',lastName:'Learner'},500,'permission-fixture')
        })
        archive = {before:await results(owner),after:undefined as unknown as LifecycleResults}
        await probe(owner,'archive','PATCH',`/api/teacher/classrooms/${c}`,{archived:true},200,'permission-fixture')
        await probe(teacher,'archived-cached-read','GET',`/api/student/tests/${main}`,undefined,403)
        const teacherDraft = {expected_revision:retained.attempts[1].draft_revision,responses:retained.attempts[1].responses}
        await probe(teacher,'archived-cached-save','PATCH',`/api/student/tests/${main}/attempt`,teacherDraft,403)
        await probe(owner,'archived-owner-save','PATCH',`/api/teacher/tests/${main}`,{title:'Forbidden archive edit'},403)
        await withActor('memberTeacher',async fresh=>{
          await probe(fresh,'archived-fresh-read','GET',`/api/student/tests/${main}`,undefined,403)
          await probe(fresh,'archived-fresh-start','POST',`/api/student/tests/${main}/start`,{},403)
        })
        await probe(owner,'unarchive','PATCH',`/api/teacher/classrooms/${c}`,{archived:false},200,'permission-fixture')
        archive.after = await results(owner); assertLifecycleGraphEquality(archive.before,archive.after)
        await workspace(owner); await capture('lifecycle-permissions',owner)
      }))
    })
    return {classroomId:c,ownerId,testIds:[main,scratch],questionIds:questions,recovery,retained,archive,disclosure,exchanges}
  } catch { throw Error(`Contextual Test lifecycle failed: ${stage}`) }
}
