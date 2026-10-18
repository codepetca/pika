/** Same complete parser, controlled command promises only; no native dispatch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assignmentListDockerInventory, survey269ComponentDockerInventory } from '../../scripts/contextual-assignment-list-proof-platform'

const id = (n: number) => n.toString(16).padStart(64, '0')
type Run = Parameters<typeof survey269ComponentDockerInventory>[0]
function fixture(size = 1) {
  const containers = Array.from({length:size},(_,n)=>({id:id(n+1),name:`/fixture_${n}`,labels:{owner:n?'foreign':'owned'},
    mounts:[{Type:'volume',Name:`fixture_volume_${n}`}],networks:{fixture:{NetworkID:id(10000+n)}},bindings:{'5432/tcp':[{HostPort:String(20000+n)}]},created:'fixed'}))
  const volumes=containers.map((_,n)=>({Name:`fixture_volume_${n}`,CreatedAt:'fixed',Labels:{owner:n?'foreign':'owned'}}))
  const networks=containers.map((c,n)=>({Id:id(10000+n),Name:`fixture_network_${n}`,Created:'fixed',Labels:{owner:n?'foreign':'owned'},Containers:{[c.id]:{}}}))
  const run:Run=async(file,args)=>{
    expect(file).toBe('docker')
    if(args[0]==='ps')return containers.map(c=>c.id).join('\n')
    if(args[0]==='volume'&&args[1]==='ls')return volumes.map(v=>v.Name).join('\n')
    if(args[0]==='network'&&args[1]==='ls')return networks.map(n=>n.Id).join('\n')
    if(args[0]==='inspect')return containers.filter(c=>args.slice(3).includes(c.id)).map(c=>JSON.stringify(c)).join('\n')
    if(args[0]==='volume'&&args[1]==='inspect')return JSON.stringify(volumes.filter(v=>args.slice(2).includes(v.Name)))
    if(args[0]==='network'&&args[1]==='inspect')return JSON.stringify(networks.filter(n=>args.slice(2).includes(n.Id)))
    throw new Error('Offline unknown command')
  }
  return {run}
}
function controlled(source:Run,deadline=Infinity){
  let active=0,maximum=0
  const calls:string[][]=[],pending:Array<(substitute?:string)=>Promise<void>>=[]
  const run:Run=async(file,args)=>{
    expect(Date.now()).toBeLessThan(deadline)
    calls.push([...args]);active++;maximum=Math.max(maximum,active)
    return new Promise<string>((resolve,reject)=>pending.push(async substitute=>{
      try{resolve(substitute??await source(file,args))}catch(error){reject(error)}finally{active--}
    }))
  }
  return {run,calls,pending,state:()=>({active,maximum})}
}
async function flush(){for(let n=0;n<30;n++)await Promise.resolve()}
afterEach(()=>vi.useRealTimers())

describe('fixed component global inventory schedule (offline)',()=>{
  it('joins three list→inspect branches in two waves and preserves the complete legacy result/check inventory',async()=>{
    const source=fixture(),c=controlled(source.run)
    let finished=false
    const operation=survey269ComponentDockerInventory(c.run).finally(()=>{finished=true})
    await flush();expect(c.calls.map(a=>a.slice(0,2))).toEqual([['ps','-aq'],['volume','ls'],['network','ls']])
    expect(c.pending).toHaveLength(3)
    await Promise.all(c.pending.splice(0).map(close=>close()));await flush()
    expect(c.calls).toHaveLength(6);expect(c.pending).toHaveLength(3);expect(finished).toBe(false)
    await Promise.all(c.pending.splice(0).map(close=>close()))
    expect(await operation).toEqual(await assignmentListDockerInventory(source.run))
    expect(c.state()).toEqual({active:0,maximum:3})
    const legacyCalls:string[][]=[]
    await assignmentListDockerInventory(async(file,args)=>{legacyCalls.push(args);return source.run(file,args)})
    expect(c.calls.map(a=>JSON.stringify(a)).sort()).toEqual(legacyCalls.map(a=>JSON.stringify(a)).sort())
  })
  it('latches an inspect mismatch, joins other owned inspections and blocks their queued second128-row batches',async()=>{
    const c=controlled(fixture(129).run)
    let finished=false
    const operation=survey269ComponentDockerInventory(c.run).catch(error=>error).finally(()=>{finished=true})
    await flush();await Promise.all(c.pending.splice(0).map(close=>close()));await flush()
    expect(c.calls).toHaveLength(6)
    const inspect=c.pending.splice(0);await inspect[0]('');await flush()
    expect(finished).toBe(false);expect(c.calls).toHaveLength(6)
    await inspect[1]();await flush();expect(finished).toBe(false);expect(c.calls).toHaveLength(6)
    await inspect[2]();expect(await operation).toBeInstanceOf(Error)
    expect(c.calls).toHaveLength(6);expect(c.state()).toEqual({active:0,maximum:3})
  })
  it('latches a malformed list before another simultaneously closing list can admit inspection',async()=>{
    const c=controlled(fixture().run)
    const operation=survey269ComponentDockerInventory(c.run).catch(error=>error)
    await flush();const lists=c.pending.splice(0)
    await Promise.all([lists[0](`${id(1)}\n${id(1)}`),lists[1](),lists[2]()])
    expect(await operation).toBeInstanceOf(Error)
    expect(c.calls).toHaveLength(3);expect(c.state().active).toBe(0)
  })
  it('joins delayed positive list closes after expiry without dispatching queued inspections',async()=>{
    vi.useFakeTimers();const deadline=Date.now()+100,c=controlled(fixture().run,deadline)
    let finished=false
    const operation=survey269ComponentDockerInventory(c.run).catch(error=>error).finally(()=>{finished=true})
    await flush();const lists=c.pending.splice(0);expect(lists).toHaveLength(3)
    vi.setSystemTime(deadline+1)
    await lists[0]();await flush();expect(finished).toBe(false);expect(c.calls).toHaveLength(3)
    await lists[1]();await flush();expect(finished).toBe(false)
    await lists[2]();expect(await operation).toBeInstanceOf(Error)
    expect(c.calls).toHaveLength(3);expect(c.state()).toEqual({active:0,maximum:3})
  })
})
