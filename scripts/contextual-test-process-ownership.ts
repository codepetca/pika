/** Exact reviewed pure ownership functions; Node builtins only. No import effects. */
import assert from 'node:assert/strict'
import {isAbsolute} from 'node:path'
export type KernelImageIdentity={uniqueId:string;imageUuid:string;pidVersion:number}
export type PendingProcess={pid:number;pgid:number;started:string;uniqueId:string;parent:Capture['identity']}
export type Capture={identity:KernelImageIdentity&{pid:number;pgid:number;started:string;executable:string;cwd:string;role:'app'|'browser'};descendants:Capture['identity'][];pending?:PendingProcess[]}
export type OwnedProcessRow={pid:number;ppid:number;pgid:number;started:string;executable:string;uniqueId:string;parentUniqueId:string;imageUuid:string;pidVersion:number|null;state?:'alive'|'starting'|'zombie'|'exiting'|'unverified'}
export type ProcessFailureCause='snapshot-schema'|'kernel-unverified'|'identity-mismatch'|'unverified-group'|'closure-deadline'|'unknown'
export const contextualTestExecutableClasses = Object.freeze(['node','chrome','chrome-helper','chrome-renderer','chrome-gpu','chrome-alerts','chrome-aperitif','chrome-aperitif-renderer','chrome-aperitif-gpu','chrome-aperitif-alerts','chrome-crashpad','empty','other'] as const)
type ExecutableClass = typeof contextualTestExecutableClasses[number]
// Diagnostic vocabulary only, NOT an allowlist. Exact pinned-install paths;
// unknown versions/lookalikes remain other. These labels never authorize images.
function executableClass(path: string): ExecutableClass {
  if (path === '') return 'empty'
  if (path === '/Users/stew/.local/share/mise/installs/node/24.12.0/bin/node') return 'node'
  if (path === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') return 'chrome'
  const prefix = '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/155.0.8059.79/Helpers/'
  if (path === prefix + 'chrome_crashpad_handler') return 'chrome-crashpad'
  const helpers: readonly [string, ExecutableClass][] = [['','chrome-helper'], [' (Renderer)','chrome-renderer'], [' (GPU)','chrome-gpu'], [' (Alerts)','chrome-alerts'],
    [' (Aperitif)','chrome-aperitif'], [' (Aperitif Renderer)','chrome-aperitif-renderer'], [' (Aperitif GPU)','chrome-aperitif-gpu'], [' (Aperitif Alerts)','chrome-aperitif-alerts']]
  for (const [suffix, label] of helpers) if (path === `${prefix}Google Chrome Helper${suffix}.app/Contents/MacOS/Google Chrome Helper${suffix}`) return label
  return 'other'
}
export type ContextualTestIdentityMismatch=Readonly<{member:'root'|'descendant';state:'alive'|'zombie'|'exiting'|'unknown';startTimeChanged:boolean;birthIdentityChanged:boolean;imageGenerationChanged:boolean;pgidChanged:boolean;executableChanged:boolean;previousExecutableClass:ExecutableClass;observedExecutableClass:ExecutableClass}>
const identityMismatches=new WeakMap<object,ContextualTestIdentityMismatch>()
/** Only the actual ownership rejection carries trusted details. WeakMap lookup
 * never inspects caller properties, prototypes, accessors or proxy traps. */
export function contextualTestIdentityMismatch(error:unknown):ContextualTestIdentityMismatch|null{return error!==null&&typeof error==='object'?identityMismatches.get(error)??null:null}
function processFailure(cause:ProcessFailureCause,detail?:ContextualTestIdentityMismatch):never{const error=Object.assign(Error('Owned process verification rejected'),{processCause:cause});if(detail)identityMismatches.set(error,Object.freeze(detail));throw error}
function processCause(e:unknown):ProcessFailureCause{const cause=(e as {processCause?:ProcessFailureCause})?.processCause;return cause&&['snapshot-schema','kernel-unverified','identity-mismatch','unverified-group','closure-deadline'].includes(cause)?cause:'unknown'}
function decimal64(value:unknown,zero=false):value is string{return typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value)&&BigInt(value)<=BigInt('18446744073709551615')&&(zero||value!=='0')}
function verifiedBirth(row:Pick<OwnedProcessRow,'started'|'uniqueId'|'parentUniqueId'>){return /^\d+:\d{1,6}$/.test(row.started)&&decimal64(row.uniqueId)&&decimal64(row.parentUniqueId,true)}
function verifiedImage(row:Pick<OwnedProcessRow,'imageUuid'|'pidVersion'>){return typeof row.imageUuid==='string'&&/^[a-f0-9]{32}$/.test(row.imageUuid)&&row.imageUuid!=='0'.repeat(32)&&typeof row.pidVersion==='number'&&Number.isInteger(row.pidVersion)&&row.pidVersion>=-2147483648&&row.pidVersion<=2147483647}
function sameImage(a:KernelImageIdentity,b:Pick<OwnedProcessRow,'imageUuid'|'pidVersion'>){return a.imageUuid===b.imageUuid&&a.pidVersion===b.pidVersion}
export function parseKernelProcessRows(text:string):OwnedProcessRow[]{
  try{assert(Buffer.byteLength(text)<=16*1024*1024);const value=JSON.parse(text);assert(value.schema===3&&Array.isArray(value.rows)&&value.rows.length<=20000)
    for(const row of value.rows){assert.deepEqual(Object.keys(row).sort(),['executable','imageUuid','parentUniqueId','pgid','pid','pidVersion','ppid','started','state','uniqueId']);assert([row.pid,row.ppid,row.pgid].every(Number.isSafeInteger));assert(row.pid>1&&row.ppid>=0&&row.pgid>=0);assert(['alive','starting','zombie','exiting','unverified'].includes(row.state));assert(typeof row.executable==='string'&&(row.executable===''||isAbsolute(row.executable)&&!/[\x00-\x1f]/.test(row.executable)))
      if(row.state==='unverified')assert(row.started==='unverified'&&row.uniqueId===''&&row.parentUniqueId===''&&row.executable===''&&row.imageUuid===''&&row.pidVersion===null)
      else{assert(verifiedBirth(row));if(row.state==='starting')assert(row.executable===''&&row.imageUuid===''&&row.pidVersion===null);else{assert(verifiedImage(row));assert(row.state!=='alive'||row.executable)}}
    }assert(new Set(value.rows.map((row:OwnedProcessRow)=>row.pid)).size===value.rows.length);return value.rows
  }catch{processFailure('snapshot-schema')}
}
export function requireLiveKernelRoot(row:OwnedProcessRow){if(row.state!=='alive'||![row.pid,row.ppid,row.pgid].every(Number.isSafeInteger)||row.pid<=1||row.ppid<0||row.pgid<=1||!row.executable||!isAbsolute(row.executable)||/[\x00-\x1f]/.test(row.executable)||!verifiedBirth(row)||!verifiedImage(row))processFailure('kernel-unverified');return row as OwnedProcessRow&KernelImageIdentity}
export function captureKernelRootIdentity(row:OwnedProcessRow,cwd:string,role:'app'|'browser'):Capture['identity']{const live=requireLiveKernelRoot(row);return {pid:live.pid,pgid:live.pgid,started:live.started,uniqueId:live.uniqueId,imageUuid:live.imageUuid,pidVersion:live.pidVersion,executable:live.executable,cwd,role}}
/** Single private FIFO for all app/browser ownership publications. Admission is
 * checked after queue waiting. A rejected transaction never strands the queue. */
export function createFamilyOperationGate(){let tail:Promise<void>=Promise.resolve()
  return {run<T>(admit:()=>void,operation:()=>Promise<T>):Promise<T>{const result=tail.then(()=>{admit();return operation()});tail=result.then(()=>undefined,()=>undefined);return result}}
}
/** Historical identities stay in the union after exit. A new identity requires
 * a presently live verified owned parent with matching kernel unique ID.
 * For descendants, pathname is an observation: it can publish after P_EXEC.
 * Birth/group/unique ID and UUID/PID-version remain fixed. A later exec, even
 * of the same binary/UUID, changes PID-version and rejects. Roots additionally
 * retain exact launch-path admission. Unseen orphans are never adopted. */
export function reconcileOwnedFamily(capture:Capture,rows:readonly OwnedProcessRow[]):Capture{
  assert.equal(new Set(rows.map(r=>r.pid)).size,rows.length,'Duplicate process snapshot PID')
  const known=new Map([capture.identity,...capture.descendants].map(p=>[p.pid,p]));assert.equal(known.size,1+capture.descendants.length)
  const live=new Map<number,OwnedProcessRow>()
  for(const p of known.values()){const row=rows.find(r=>r.pid===p.pid);if(row){if(row.state==='unverified'||row.state==='starting'||!verifiedBirth(row)||!verifiedImage(row))processFailure('kernel-unverified');if(row.started!==p.started||row.uniqueId!==p.uniqueId||row.pgid!==p.pgid||!sameImage(p,row)||p.pid===capture.identity.pid&&(!(row.state==='zombie'||row.state==='exiting')||row.executable!=='')&&row.executable!==p.executable){
    // Fixed booleans/classes only. IDs, UUIDs, paths and versions stay private.
    let detail:ContextualTestIdentityMismatch|undefined
    try{detail={member:p.pid===capture.identity.pid?'root':'descendant',state:row.state==='alive'||row.state==='zombie'||row.state==='exiting'?row.state:'unknown',
      startTimeChanged:row.started!==p.started,birthIdentityChanged:row.uniqueId!==p.uniqueId,imageGenerationChanged:!sameImage(p,row),pgidChanged:row.pgid!==p.pgid,executableChanged:(!(row.state==='zombie'||row.state==='exiting')||row.executable!=='')&&row.executable!==p.executable,
      previousExecutableClass:executableClass(p.executable),observedExecutableClass:executableClass(row.executable)}}catch{/* Diagnostics cannot replace rejection. */}
    processFailure('identity-mismatch',detail)
  }if(row.state!=='zombie'&&row.state!=='exiting')live.set(row.pid,row)}}
  const pending = new Map((capture.pending ?? []).map(p => [p.pid, p]))
  assert.equal(pending.size, (capture.pending ?? []).length)
  const bind = (row: OwnedProcessRow) => {
    known.set(row.pid, captureKernelRootIdentity(row,capture.identity.cwd,capture.identity.role))
    live.set(row.pid, row)
  }
  // A fork inherits its parent's pathname before first exec. Retain only its
  // birth and verified-parent identity until an initialized image generation
  // can be bound. P_EXEC does NOT establish complete pathname publication.
  // Pending is observation state, never ownership or group-signal coverage.
  for (const p of pending.values()) {
    assert(!known.has(p.pid))
    const row = rows.find(r => r.pid === p.pid), parent = known.get(p.parent.pid), parentRow = live.get(p.parent.pid)
    if (!row || row.state !== 'starting' && row.state !== 'alive' || !parent || parentRow?.state !== 'alive') processFailure('kernel-unverified')
    if (!verifiedBirth(row)) processFailure('kernel-unverified')
    if (row.started !== p.started || row.uniqueId !== p.uniqueId || row.pgid !== p.pgid || row.ppid !== p.parent.pid || row.parentUniqueId !== parent.uniqueId ||
      parent.uniqueId !== p.parent.uniqueId || parent.started !== p.parent.started || parent.pgid !== p.parent.pgid || !sameImage(parent,p.parent)) processFailure('identity-mismatch')
    if (row.state === 'alive') { assert(row.executable); bind(row); pending.delete(p.pid) }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (known.has(row.pid) || pending.has(row.pid) || !live.has(row.ppid)) continue
      if (row.state !== 'alive' && row.state !== 'starting') processFailure('kernel-unverified')
      const parent = known.get(row.ppid)!
      if (!verifiedBirth(row) || row.parentUniqueId !== parent.uniqueId || live.get(parent.pid)?.state !== 'alive') processFailure('kernel-unverified')
      assert(row.pid > 1 && row.pgid > 1 && /^\d+:\d{1,6}$/.test(row.started))
      if (capture.identity.role === 'app') assert.equal(row.pgid, capture.identity.pgid)
      if (row.state === 'starting') {
        pending.set(row.pid, { pid:row.pid, pgid:row.pgid, started:row.started, uniqueId:row.uniqueId, parent:{...parent} })
      } else { assert(row.executable); bind(row); changed = true }
    }
  }
  const groups = new Set([...known.values(), ...pending.values()].map(p => p.pgid))
  if (rows.some(r => groups.has(r.pgid) && !known.has(r.pid) && !pending.has(r.pid) || pending.has(r.ppid))) processFailure('unverified-group')
  return {identity:capture.identity,descendants:[...known.values()].filter(p=>p.pid!==capture.identity.pid),pending:[...pending.values()]}
}
export function ownedFamilyAbsent(capture:Capture,rows:readonly OwnedProcessRow[]){const checked=reconcileOwnedFamily(capture,rows);return !checked.pending?.length&&!rows.some(r=>[checked.identity,...checked.descendants].some(p=>p.pid===r.pid))}
/** Actual native state/settlement seam, also CPU-tested with injected rows and
 * signals. Every signal has a fresh identity/group snapshot and admission. */
export async function settleOwnedFamily(initial:Capture,mode:'group'|'pid',input:{rows:()=>Promise<OwnedProcessRow[]>;now:()=>number;admit:()=>void;signal:(pid:number,signal:'SIGTERM'|'SIGKILL')=>void;closed:()=>boolean;end:number;update:(capture:Capture)=>void}):Promise<{closed:boolean;absent:boolean}>{
  let family=initial;const term=new Set<string>(),kill=new Set<string>(),killAt=input.end-4000
  const refresh=async()=>{input.admit();const rows=await input.rows();input.admit();assert(input.now()<input.end);family=reconcileOwnedFamily(family,rows);input.update(family);return rows}
  const key=(p:Capture['identity'])=>`${p.pid}:${p.uniqueId}:${p.started}:${p.pgid}:${p.pidVersion}:${p.imageUuid}`
  while(input.now()<input.end){let rows=await refresh();if(family.pending?.length)continue;const live=[family.identity,...family.descendants].filter(p=>rows.some(r=>r.pid===p.pid))
    if(!live.length){if(input.closed())return {closed:true,absent:true};continue}
    const signalable=live.filter(p=>rows.some(r=>r.pid===p.pid&&r.state!=='zombie'&&r.state!=='exiting'))
    for(const value of ['SIGTERM','SIGKILL'] as const){if(value==='SIGKILL'&&input.now()<killAt)continue;const sent=value==='SIGTERM'?term:kill
      if(mode==='group'){if(signalable.every(p=>sent.has(key(p))))continue;rows=await refresh();if(family.pending?.length)break;const current=[family.identity,...family.descendants].filter(p=>rows.some(r=>r.pid===p.pid&&r.state!=='zombie'&&r.state!=='exiting'));if(!current.length)continue
        assert(current.every(p=>p.pgid===family.identity.pgid));input.admit();assert(input.now()<input.end);input.signal(-family.identity.pgid,value);for(const p of current)sent.add(key(p))
      }else for(const p of signalable){if(sent.has(key(p)))continue;rows=await refresh();if(family.pending?.length)break;const current=rows.find(r=>r.pid===p.pid);if(!current||current.state==='zombie'||current.state==='exiting')continue;assert(current.started===p.started&&current.uniqueId===p.uniqueId&&current.pgid===p.pgid&&sameImage(p,current)&&(p.pid!==family.identity.pid||current.executable===p.executable))
        input.admit();assert(input.now()<input.end);input.signal(p.pid,value);sent.add(key(p))}
    }
  }
  processFailure('closure-deadline')
}
