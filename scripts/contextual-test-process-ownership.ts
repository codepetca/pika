/** Exact reviewed pure ownership functions; Node builtins only. No import effects. */
import assert from 'node:assert/strict'
import {isAbsolute} from 'node:path'
export type Capture={identity:{pid:number;pgid:number;started:string;executable:string;cwd:string;role:'app'|'browser'};descendants:Capture['identity'][]}
export type OwnedProcessRow={pid:number;ppid:number;pgid:number;started:string;executable:string;state?:'alive'|'zombie'|'exiting'|'unverified'}
export type ProcessFailureCause='snapshot-schema'|'kernel-unverified'|'identity-mismatch'|'unverified-group'|'closure-deadline'|'unknown'
export const contextualTestExecutableClasses = Object.freeze(['node','chrome','chrome-helper','chrome-renderer','chrome-gpu','chrome-alerts','chrome-aperitif','chrome-aperitif-renderer','chrome-aperitif-gpu','chrome-aperitif-alerts','chrome-crashpad','empty','other'] as const)
type ExecutableClass = typeof contextualTestExecutableClasses[number]
// Diagnostic vocabulary only, NOT an allowlist. Exact pinned-install paths;
// unknown versions/lookalikes remain other and every mismatch still rejects.
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
export type ContextualTestIdentityMismatch=Readonly<{member:'root'|'descendant';state:'alive'|'zombie'|'exiting'|'unknown';startTimeChanged:boolean;pgidChanged:boolean;executableChanged:boolean;previousExecutableClass:ExecutableClass;observedExecutableClass:ExecutableClass}>
const identityMismatches=new WeakMap<object,ContextualTestIdentityMismatch>()
/** Only the actual ownership rejection carries trusted details. WeakMap lookup
 * never inspects caller properties, prototypes, accessors or proxy traps. */
export function contextualTestIdentityMismatch(error:unknown):ContextualTestIdentityMismatch|null{return error!==null&&typeof error==='object'?identityMismatches.get(error)??null:null}
function processFailure(cause:ProcessFailureCause,detail?:ContextualTestIdentityMismatch):never{const error=Object.assign(Error('Owned process verification rejected'),{processCause:cause});if(detail)identityMismatches.set(error,Object.freeze(detail));throw error}
function processCause(e:unknown):ProcessFailureCause{const cause=(e as {processCause?:ProcessFailureCause})?.processCause;return cause&&['snapshot-schema','kernel-unverified','identity-mismatch','unverified-group','closure-deadline'].includes(cause)?cause:'unknown'}
export function parseKernelProcessRows(text:string):OwnedProcessRow[]{
  try{assert(Buffer.byteLength(text)<=16*1024*1024);const value=JSON.parse(text);assert(value.schema===1&&Array.isArray(value.rows)&&value.rows.length<=20000)
    for(const row of value.rows){assert.deepEqual(Object.keys(row).sort(),['executable','pgid','pid','ppid','started','state']);assert([row.pid,row.ppid,row.pgid].every(Number.isSafeInteger));assert(row.pid>1&&row.ppid>=0&&row.pgid>=0);assert(['alive','zombie','exiting','unverified'].includes(row.state));assert(row.started==='unverified'||/^\d+:\d{1,6}$/.test(row.started));assert(typeof row.executable==='string'&&(row.executable===''||isAbsolute(row.executable)&&!/[\x00-\x1f]/.test(row.executable)));assert(row.state!=='alive'||row.executable)}return value.rows
  }catch{processFailure('snapshot-schema')}
}
export function requireLiveKernelRoot(row:OwnedProcessRow){if(row.state!=='alive'||!row.executable||!/^\d+:\d{1,6}$/.test(row.started))processFailure('kernel-unverified');return row}
/** Single private FIFO for all app/browser ownership publications. Admission is
 * checked after queue waiting. A rejected transaction never strands the queue. */
export function createFamilyOperationGate(){let tail:Promise<void>=Promise.resolve()
  return {run<T>(admit:()=>void,operation:()=>Promise<T>):Promise<T>{const result=tail.then(()=>{admit();return operation()});tail=result.then(()=>undefined,()=>undefined);return result}}
}
/** Historical identities stay in the union after exit. A new identity requires
 * a presently live verified owned parent; unseen orphans are never adopted. */
export function reconcileOwnedFamily(capture:Capture,rows:readonly OwnedProcessRow[]):Capture{
  assert.equal(new Set(rows.map(r=>r.pid)).size,rows.length,'Duplicate process snapshot PID')
  const known=new Map([capture.identity,...capture.descendants].map(p=>[p.pid,p]));assert.equal(known.size,1+capture.descendants.length)
  const live=new Map<number,OwnedProcessRow>()
  for(const p of known.values()){const row=rows.find(r=>r.pid===p.pid);if(row){if(row.state==='unverified')processFailure('kernel-unverified');if(row.started!==p.started||row.pgid!==p.pgid||(!(row.state==='zombie'||row.state==='exiting')||row.executable!=='')&&row.executable!==p.executable){
    // Preserve the rejection predicate above, including the empty-executable
    // exception for terminal states; retain only fixed comparison results.
    let detail:ContextualTestIdentityMismatch|undefined
    try{detail={member:p.pid===capture.identity.pid?'root':'descendant',state:row.state==='alive'||row.state==='zombie'||row.state==='exiting'?row.state:'unknown',
      startTimeChanged:row.started!==p.started,pgidChanged:row.pgid!==p.pgid,executableChanged:(!(row.state==='zombie'||row.state==='exiting')||row.executable!=='')&&row.executable!==p.executable,
      previousExecutableClass:executableClass(p.executable),observedExecutableClass:executableClass(row.executable)}}catch{/* Diagnostics cannot replace rejection. */}
    processFailure('identity-mismatch',detail)
  }if(row.state!=='zombie'&&row.state!=='exiting')live.set(row.pid,row)}}
  let changed=true;while(changed){changed=false;for(const row of rows)if(!known.has(row.pid)&&live.has(row.ppid)){if(row.state==='unverified'||row.state==='zombie'||row.state==='exiting')processFailure('kernel-unverified');assert(row.pid>1&&row.pgid>1&&row.started&&row.executable);if(capture.identity.role==='app')assert.equal(row.pgid,capture.identity.pgid)
    known.set(row.pid,{pid:row.pid,pgid:row.pgid,started:row.started,executable:row.executable,cwd:capture.identity.cwd,role:capture.identity.role});live.set(row.pid,row);changed=true}}
  const groups=new Set([...known.values()].map(p=>p.pgid));if(rows.some(r=>groups.has(r.pgid)&&!known.has(r.pid)))processFailure('unverified-group')
  return {identity:capture.identity,descendants:[...known.values()].filter(p=>p.pid!==capture.identity.pid)}
}
export function ownedFamilyAbsent(capture:Capture,rows:readonly OwnedProcessRow[]){const checked=reconcileOwnedFamily(capture,rows);return !rows.some(r=>[checked.identity,...checked.descendants].some(p=>p.pid===r.pid))}
/** Actual native state/settlement seam, also CPU-tested with injected rows and
 * signals. Every signal has a fresh identity/group snapshot and admission. */
export async function settleOwnedFamily(initial:Capture,mode:'group'|'pid',input:{rows:()=>Promise<OwnedProcessRow[]>;now:()=>number;admit:()=>void;signal:(pid:number,signal:'SIGTERM'|'SIGKILL')=>void;closed:()=>boolean;end:number;update:(capture:Capture)=>void}):Promise<{closed:boolean;absent:boolean}>{
  let family=initial;const term=new Set<string>(),kill=new Set<string>(),killAt=input.end-4000
  const refresh=async()=>{input.admit();const rows=await input.rows();input.admit();assert(input.now()<input.end);family=reconcileOwnedFamily(family,rows);input.update(family);return rows}
  const key=(p:Capture['identity'])=>`${p.pid}:${p.started}:${p.pgid}`
  while(input.now()<input.end){let rows=await refresh();const live=[family.identity,...family.descendants].filter(p=>rows.some(r=>r.pid===p.pid))
    if(!live.length){if(input.closed())return {closed:true,absent:true};continue}
    const signalable=live.filter(p=>rows.some(r=>r.pid===p.pid&&r.state!=='zombie'&&r.state!=='exiting'))
    for(const value of ['SIGTERM','SIGKILL'] as const){if(value==='SIGKILL'&&input.now()<killAt)continue;const sent=value==='SIGTERM'?term:kill
      if(mode==='group'){if(signalable.every(p=>sent.has(key(p))))continue;rows=await refresh();const current=[family.identity,...family.descendants].filter(p=>rows.some(r=>r.pid===p.pid&&r.state!=='zombie'&&r.state!=='exiting'));if(!current.length)continue
        assert(current.every(p=>p.pgid===family.identity.pgid));input.admit();assert(input.now()<input.end);input.signal(-family.identity.pgid,value);for(const p of current)sent.add(key(p))
      }else for(const p of signalable){if(sent.has(key(p)))continue;rows=await refresh();const current=rows.find(r=>r.pid===p.pid);if(!current||current.state==='zombie'||current.state==='exiting')continue;assert(current.started===p.started&&current.pgid===p.pgid&&current.executable===p.executable)
        input.admit();assert(input.now()<input.end);input.signal(p.pid,value);sent.add(key(p))}
    }
  }
  processFailure('closure-deadline')
}
