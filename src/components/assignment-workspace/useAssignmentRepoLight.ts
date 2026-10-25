'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import { repoLightContextReplySchema, repoLightImportResultSchema, repoLightReportReplySchema, repoLightRunReplySchema, type RepoLightContextReply, type RepoLightReportReply, type RepoLightRunView } from '@/lib/validations/repolight'
import type { RepositoryFeedbackImportSession } from './useTeacherStudentWorkController'

type RecordState = {owner: string; targetOwner: string; context: RepoLightContextReply | null; report: RepoLightReportReply['report'] | null; busy: boolean; error: string}
const message = (caught: unknown) => caught instanceof Error && !caught.message.startsWith('[') ? caught.message.replaceAll('_',' ') : 'Repository review is unavailable. Try refreshing its status.'
const post = (body: unknown): RequestInit => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})

export function useAssignmentRepoLight({classroomId,assignmentId,studentId,active,paused,selectedRequirementId,beginImport}: {
  classroomId: string; assignmentId: string; studentId: string; active: boolean; paused: boolean; selectedRequirementId?: string
  beginImport: () => RepositoryFeedbackImportSession
}) {
  const targetOwner = JSON.stringify([classroomId,assignmentId,studentId])
  const owner = JSON.stringify([classroomId,assignmentId,studentId,selectedRequirementId || null])
  const ownerRef = useRef(owner)
  if (ownerRef.current !== owner) ownerRef.current = owner
  const generation = useRef(0)
  const alive = useRef(true)
  const access = useRef({active,paused})
  access.current = {active,paused}
  const admission = useRef<{owner:string;sourceKey:string;requestId:string} | null>(null)
  const boundSelection = useRef<string | null>(null)
  const imports = useRef<{key:string;requestId:string} | null>(null)
  const [importedPreviews,setImportedPreviews] = useState<Record<string,string[]>>({})
  const [refresh,setRefresh] = useState(0)
  const [record,setRecord] = useState<RecordState>({owner,targetOwner,context:null,report:null,busy:false,error:''})
  const current = record.owner === owner ? record : record.targetOwner === targetOwner ? {...record,owner,context:record.context ? {...record.context,run:null} : null,report:null,busy:false,error:''} : {owner,targetOwner,context:null,report:null,busy:false,error:''}
  const base = `/api/teacher/assignments/${assignmentId}/students/${studentId}/repolight/runs`
  const update = (value: Partial<RecordState>) => setRecord(previous => ({...(previous.owner === owner ? previous : {owner,targetOwner,context:null,report:null,busy:false,error:''}),...value,owner,targetOwner}))

  useEffect(() => {alive.current = true;return () => {alive.current = false;generation.current += 1}},[])
  useEffect(() => {
    if (!active) return
    const cycle = ++generation.current
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 2000
    let allowAdvance = false
    const controller = new AbortController()
    const valid = () => live && alive.current && generation.current === cycle && ownerRef.current === owner
    const set = (value: Partial<RecordState>) => {if (valid()) setRecord(previous => ({...(previous.owner === owner ? previous : {owner,targetOwner,context:null,report:null,busy:false,error:''}),...value,owner,targetOwner}))}
    async function read(url: string) {
      return fetchJSONWithCache(`repolight:${owner}:${cycle}:${url}`,() => fetchJSON<unknown>(url,{init:{signal:controller.signal,cache:'no-store'},errorMessage:'Could not refresh repository review.'}),0)
    }
    async function poll(run: RepoLightRunView) {
      if (!valid()) return
      try {
        let next = repoLightRunReplySchema.parse(await read(`${base}/${run.id}`)).run
        if (next.id !== run.id) throw new Error('Repository run changed. Reopen its review.')
        if (!valid()) return
        if (next.canAdvance && allowAdvance && access.current.active && !access.current.paused) {
          next = repoLightRunReplySchema.parse(await fetchJSON(`${base}/${run.id}/advance`,{init:{...post({}),signal:controller.signal},errorMessage:'Could not advance repository analysis.'})).run
          if (next.id !== run.id) throw new Error('Repository run changed. Reopen its review.')
        }
        if (!valid()) return
        setRecord(previous => previous.owner === owner && previous.context ? {...previous,context:{...previous.context,run:next},error:''} : previous)
        if (['queued','submitting','running'].includes(next.status)) {timer = setTimeout(() => {void poll(next)},delay);delay = Math.min(15000,Math.round(delay * 1.5))}
      } catch (caught) {set({error:message(caught)})}
    }
    async function load() {
      try {
        const loadedContext = repoLightContextReplySchema.parse(await read(base))
        const context = selectedRequirementId && boundSelection.current !== owner ? {...loadedContext,run:null} : loadedContext
        allowAdvance = !paused && context.state === 'ready'
        set({context,error:'',busy:false})
        if (valid() && context.run && ['queued','submitting','running'].includes(context.run.status)) timer = setTimeout(() => {void poll(context.run!)},delay)
      } catch (caught) {set({error:message(caught),busy:false})}
    }
    void load()
    return () => {live = false;generation.current += 1;controller.abort();if (timer) clearTimeout(timer)}
  },[active,paused,owner,targetOwner,base,refresh,selectedRequirementId])

  async function analyze() {
    const chosen = current.context?.source.repositoryChoices.some(choice => choice.requirementId === selectedRequirementId)
    const resolved = current.context?.source.available || (current.context?.source.notice === 'repolight_requirement_required' && chosen)
    if (ownerRef.current !== owner || !access.current.active || access.current.paused || current.busy || current.context?.state !== 'ready' || !resolved) return
    const sourceKey = JSON.stringify(current.context.source)
    if (admission.current?.owner !== owner || admission.current.sourceKey !== sourceKey) admission.current = {owner,sourceKey,requestId:crypto.randomUUID()}
    const cycle = ++generation.current
    update({busy:true,error:'',report:null})
    try {
      const requirementId = chosen ? selectedRequirementId : current.context.source.requirementId
      const payload = {requestId:admission.current!.requestId,...(requirementId ? {requirementId} : {})}
      const run = repoLightRunReplySchema.parse(await fetchJSON(base,{init:post(payload),errorMessage:'Could not start repository analysis. Try Analyze again to resume this request.'})).run
      if (!alive.current || ownerRef.current !== owner || generation.current !== cycle) return
      admission.current = null
      boundSelection.current = owner
      update({context:{...current.context,run},busy:false})
      setRefresh(value => value + 1)
    } catch (caught) {if (alive.current && ownerRef.current === owner && generation.current === cycle) update({busy:false,error:message(caught)})}
  }

  async function openReport() {
    const run = current.context?.run
    if (ownerRef.current !== owner || !run?.reportAvailable || !access.current.active || current.busy) return
    const cycle = generation.current
    update({busy:true,error:''})
    try {
      const reply = repoLightReportReplySchema.parse(await fetchJSONWithCache(`repolight:${owner}:report:${run.id}`,() => fetchJSON(`${base}/${run.id}/report`,{init:{cache:'no-store'},errorMessage:'Could not load repository report.'}),0))
      if (reply.run.id !== run.id) throw new Error('Repository report changed. Refresh its status.')
      if (!alive.current || ownerRef.current !== owner || generation.current !== cycle) return
      update({report:reply.report,context:current.context ? {...current.context,run:reply.run} : null,busy:false})
    } catch (caught) {if (alive.current && ownerRef.current === owner && generation.current === cycle) update({busy:false,error:message(caught)})}
  }

  const previewKey = (scopeKey: string) => JSON.stringify([owner,current.report?.bundle.bundleRef,current.report?.reportDigest,scopeKey])
  const isFeedbackImported = (scopeKey: string,text: string) => importedPreviews[previewKey(scopeKey)]?.includes(text) ?? false

  async function importFeedback(scopeKey: string,text: string) {
    const run = current.context?.run
    if (ownerRef.current !== owner || !access.current.active || access.current.paused || current.context?.state !== 'ready' || !run?.canImport || !run.sourceCurrent || !current.report) throw new Error('This report is stale or unavailable for feedback import.')
    if (isFeedbackImported(scopeKey,text)) return
    const acceptedPreviewKey = previewKey(scopeKey)
    const session = beginImport()
    const key = JSON.stringify([owner,run.id,current.report.reportDigest,scopeKey,text,session.expectedDocUpdatedAt])
    if (imports.current?.key !== key) imports.current = {key,requestId:crypto.randomUUID()}
    try {
      const reply = repoLightImportResultSchema.parse(await fetchJSON(`${base}/${run.id}/import`,{init:post({requestId:imports.current.requestId,scopeKey,expectedDocUpdatedAt:session.expectedDocUpdatedAt,expectedReportDigest:current.report.reportDigest,feedbackText:text}),errorMessage:'Could not add repository feedback. Your reviewed text is kept; retry to reconcile.'}))
      if (!alive.current || ownerRef.current !== owner) throw new Error('The selected student or repository changed. Reopen their work before reconciling feedback.')
      session.accept(reply.doc)
      setImportedPreviews(previous => ({...previous,[acceptedPreviewKey]:[...(previous[acceptedPreviewKey] || []),text]}))
      imports.current = null
    } finally {session.finish()}
  }

  return {...current,run:current.context?.run || null,analyze,openReport,importFeedback,isFeedbackImported,refreshStatus:() => setRefresh(value => value + 1)}
}
