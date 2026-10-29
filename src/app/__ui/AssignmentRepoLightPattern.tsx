'use client'

import { useState } from 'react'
import { AssignmentRepositoryReport } from '@/components/assignment-workspace/AssignmentRepositoryReport'
import { publicRepositoryBundleSchema } from '@/lib/contracts/repolight/report/bundle-contract'
import { Button, ContentDialog } from '@/ui'
import fixture from '../../../tests/unit/repolight/fixture.json'

const bundle = publicRepositoryBundleSchema.parse({...fixture.bundle, selection:{status:'matched',requestedGithubLogin:'sample-student',contributorId:'github-sample-student',notice:null}})
const assignmentSummary = {scopeKey:'contributor:github-sample-student',rulesVersion:'1.0.0' as const,text:'For the selected GitHub account, the assignment contains 12 included commits; the first observed commit author timestamp was Oct 5, 2026, 9:22 a.m. EDT, approximately 9.37 hours after release, and 3 of 12 (25%) were in the final 24 hours before the deadline. These figures describe recorded commit author timestamps.'}

/** Fixed, synthetic wire evidence; no API, authentication or provider calls. */
export function AssignmentRepoLightPattern() {
  const [open,setOpen] = useState(false)
  const [comment,setComment] = useState('Existing Pika comment draft.')
  return <section id="assignment-repolight" data-testid="assignment-repolight-pattern" className="space-y-3">
    <h3 className="font-semibold">Assignment repository report</h3>
    <p className="text-sm text-text-muted">Production report viewer with synthetic evidence and a local append receipt. Nothing is saved or sent.</p>
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>View repository report</Button>
    <div data-testid="repolight-pattern-comment" className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{comment}</div>
    <ContentDialog isOpen={open} onClose={() => setOpen(false)} title="Repository report" subtitle="Synthetic assignment fixture">
      <AssignmentRepositoryReport bundle={bundle} assignmentSummary={assignmentSummary} canImport onImportFeedback={async (_scopeKey,text) => {setComment(current => `${current}\n\n${text}`)}} />
    </ContentDialog>
  </section>
}
