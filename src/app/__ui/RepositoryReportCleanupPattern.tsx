'use client'

import { useState } from 'react'
import { Button,ContentDialog } from '@/ui'
import { RepositoryReportCleanupDetails } from '@/components/StudentRepositoryReportCleanupDialog'
import type { LiveCleanupStatus,LiveCleanupTarget } from '@/lib/validations/live-student-cleanup'
const target:LiveCleanupTarget={student_id:'20000000-0000-4000-8000-000000000001',generation_id:'30000000-0000-4000-8000-000000000001',email:'synthetic@example.invalid',name:'Synthetic removed student',scope:'repolight_only',report_cleanup_available:true}
const pending:LiveCleanupStatus={operation_id:'40000000-0000-4000-8000-000000000001',scope:'repolight_only',academic_preserved:true,status:'provider_pending',pal:'out_of_scope',bara:'out_of_scope',local_status:'not_started',cleanup_completed:false,repolight_cleanup_pending:true,blockers:[]}
export function RepositoryReportCleanupPattern(){
 const [open,setOpen]=useState(false),[complete,setComplete]=useState(false)
 const operation:LiveCleanupStatus=complete?{...pending,status:'completed',cleanup_completed:true,repolight_cleanup_pending:false}:pending
 return <section id="repository-report-cleanup" data-testid="repository-report-cleanup-pattern" className="space-y-3"><h3 className="font-semibold">Removed membership repository reports</h3><p className="text-sm text-text-muted">Production dialog content with fixed synthetic progress. No requests or deletion occur.</p><Button size="sm" variant="secondary" onClick={()=>{setComplete(false);setOpen(true)}}>Preview report cleanup</Button><ContentDialog isOpen={open} onClose={()=>setOpen(false)} title="Remove repository reports" subtitle="Synthetic classroom" maxWidth="max-w-xl" showFooterClose={false}><RepositoryReportCleanupDetails target={target} state={{operation,busy:false,ready:true,enabled:true,error:'',hasSaved:true,cleanupScope:'repolight_only'}} onClose={()=>setOpen(false)} onCheck={()=>undefined} onAdvance={()=>setComplete(true)} /></ContentDialog></section>
}
