import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Importing the Python module never selects the real backend or invokes its CLI.
const harness = String.raw`
import importlib.util, json, pathlib, tempfile, unittest, os, signal, threading, sys, subprocess
sys.dont_write_bytecode=True
spec = importlib.util.spec_from_file_location('host', ${JSON.stringify(resolve('scripts/run-ci-tart-host.py'))})
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
class Fake:
    def __init__(self):
        self.calls=[]; self.vms=[{'Name':h.TEMPLATE,'Running':False}]; self.is_private=True
        self.fail_cleanup=False; self.run_error=None; self.steal=False; self.lease=None
    def private(self): self.calls.append('private'); return self.is_private
    def demand(self, hint): self.calls.append('demand'); return True
    def inventory(self): self.calls.append('inventory'); return self.vms.copy()
    def clone(self, vm):
        self.calls.append('clone'); assert self.lease.exists()
        self.vms.append({'Name':vm,'Running':False})
    def start(self, vm):
        self.calls.append('start')
        next(v for v in self.vms if v['Name']==vm)['Running']=True
    def ready(self, vm): self.calls.append('ready')
    def preflight(self, vm): self.calls.append('preflight')
    def token(self): self.calls.append('token'); return 'PRIVATE-TOKEN-SENTINEL'
    def register(self, vm, token):
        self.calls.append('register'); assert token=='PRIVATE-TOKEN-SENTINEL'
        return {'id':7,'name':vm,'ephemeral':True,'repo':h.REPOSITORY}
    def run_one(self, vm, idle, lifetime):
        self.calls.append('run_one')
        if self.steal: self.lease.unlink(); self.lease.write_text('foreign lease')
        if self.run_error: raise self.run_error
        return {'runner_exit':0,'assigned_job':None}
    def unregister(self, vm, identity): self.calls.append('unregister')
    def stop(self, vm):
        self.calls.append('stop')
        if self.fail_cleanup: raise h.Refusal('stop-failed')
        next(v for v in self.vms if v['Name']==vm)['Running']=False
        return True
    def delete(self, vm): self.calls.append('delete'); self.vms=[v for v in self.vms if v['Name']!=vm]

with tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp); lease=root/'lease'; receipts=root/'receipts'; fake=Fake(); fake.lease=lease
    driver=h.HostDriver(fake, lease, receipts)
    def serve(): return driver.execute('serve-one', h.ACTIVATION_ACK, None, 1, 2)
`

function offline(code: string) {
  const result = spawnSync('python3', ['-c', harness + code], { encoding: 'utf8', timeout: 10_000 })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  return result.stdout
}

describe('serial Tart host admission (offline)', () => {
  it('defaults to a non-executing plan and requires literal activation acknowledgement', () => {
    offline(String.raw`
    plan=driver.execute('plan', '', None, 1, 2)
    assert fake.calls==[] and not lease.exists() and not receipts.exists()
    try: driver.execute('serve-one', '', None, 1, 2)
    except h.Refusal: pass
    else: raise AssertionError('missing acknowledgement accepted')
    assert fake.calls==[] and not lease.exists()
`)
  })

  it('refuses public repository before boot, lease claim or token API', () => {
    offline(String.raw`
    fake.is_private=False
    result=serve()
    assert result['status']=='refused' and fake.calls==['private']
    assert not lease.exists()
`)
  })

  it('never steals busy, stale or symlinked leases', () => {
    offline(String.raw`
    lease.write_text('foreign expired owner')
    result=serve(); assert result['status']=='refused'
    assert lease.read_text()=='foreign expired owner' and 'clone' not in fake.calls
    lease.unlink(); foreign=root/'foreign'; foreign.write_text('do not change')
    lease.symlink_to(foreign)
    result=serve(); assert result['status']=='refused'
    assert lease.is_symlink() and foreign.read_text()=='do not change'
`)
  })

  it('atomically admits only one contender', () => {
    offline(String.raw`
    leases=[h.Lease(lease, 'pika-ci-job-'+str(i)) for i in range(2)]
    barrier=threading.Barrier(2); winners=[]
    def claim(item):
        barrier.wait()
        try: item.acquire(); winners.append(item)
        except h.Refusal: pass
    threads=[threading.Thread(target=claim,args=(item,)) for item in leases]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert len(winners)==1 and (lease.stat().st_mode & 0o777)==0o600
    winners[0].release(); assert not lease.exists()
`)
  })

  it('refuses any running VM and releases only its own admission', () => {
    offline(String.raw`
    fake.vms.append({'Name':'hq-foreign','Running':True})
    result=serve(); assert result['status']=='refused'
    assert 'clone' not in fake.calls and 'stop' not in fake.calls and not lease.exists()
`)
  })

  it('rehearses unregistered isolation and verified destruction without GitHub calls', () => {
    offline(String.raw`
    result=driver.execute('rehearse', '', None, 1, 2)
    assert result['status']=='rehearsed' and not lease.exists()
    assert not any(c in fake.calls for c in ['private','demand','token','register','run_one','unregister'])
    assert fake.calls.index('stop') < fake.calls.index('delete')
    assert fake.vms==[{'Name':h.TEMPLATE,'Running':False}]
    assert (receipts.stat().st_mode & 0o777)==0o700
    files=list(receipts.rglob('*.json')); assert files
    assert all((p.stat().st_mode & 0o777)==0o600 for p in files)
`)
  })

  it.each(['timeout', 'signal'])('contains %s and preserves primary failure after clean teardown', kind => {
    offline(String.raw`
    fake.run_error=h.Refusal(${JSON.stringify(kind)})
    result=serve(); assert result['status']=='failed'
    assert result['failure']==${JSON.stringify(kind)} and not lease.exists()
    assert 'stop' in fake.calls and 'delete' in fake.calls and 'unregister' in fake.calls
`)
  })

  it('retains admission if teardown fails or the lease is replaced', () => {
    offline(String.raw`
    fake.fail_cleanup=True
    result=serve(); assert result['status']=='cleanup-required' and lease.exists()
    assert 'delete' not in fake.calls
    lease.unlink(); fake.fail_cleanup=False; fake.vms=[{'Name':h.TEMPLATE,'Running':False}]
    fake.steal=True
    result=serve(); assert result['status']=='cleanup-required'
    assert lease.read_text()=='foreign lease'
`)
  })

  it('does not report demand hints as actual job binding or print private child output', () => {
    offline(String.raw`
    result=serve(); assert result['status']=='completed'
    assert result['assigned_job'] is None and result['registration']['id']==7
    content=''.join(p.read_text() for p in receipts.rglob('*') if p.is_file())
    assert 'PRIVATE-TOKEN-SENTINEL' not in content
    assert 'PRIVATE-TOKEN-SENTINEL' not in json.dumps(result)
`)
  })

  it('uses static encoded guest transport and a whitelist environment', () => {
    offline(String.raw`
    backend=h.Backend(root)
    assert set(backend.host_environment())=={'HOME','PATH','LANG'}
    capture=[]
    def command(args, **kwargs): capture.append((args,kwargs)); return '{}'
    backend.command=command
    backend.guest('pika-ci-job-test', 'print("$SECRET")', payload={'token':'PRIVATE-TOKEN-SENTINEL'})
    args,options=capture[0]
    assert '-i' in args and 'PRIVATE-TOKEN-SENTINEL' not in ' '.join(args)
    assert '$' not in ' '.join(args)
    assert 'PRIVATE-TOKEN-SENTINEL' in options['input_data']
    assert options['secret'] is True
    assert 'DOCKER_CONTEXT' not in h.GUEST_ENV
    assert 'DOCKER_HOST' not in h.GUEST_ENV
    assert h.DOCKER_SOCKET=='unix:///run/user/1002/docker.sock'
    assert not any(k.startswith(('AWS_', 'GH_', 'GITHUB_TOKEN', 'SUPABASE_', 'WORKOS_')) for k in h.GUEST_ENV)
`)
  })

  it('rejects invalid registration binding and nonzero runner results', () => {
    offline(String.raw`
    fake.register=lambda vm, token: {'id':7,'name':'foreign','repo':h.REPOSITORY,'ephemeral':True}
    result=serve(); assert result['status']=='failed' and result['failure']=='registration-binding-mismatch'
    assert 'run_one' not in fake.calls and not lease.exists()
    fake.register=lambda vm, token: {'id':7,'name':vm,'repo':h.REPOSITORY,'ephemeral':True}
    fake.run_one=lambda *args: {'runner_exit':1,'assigned_job':None}
    result=serve(); assert result['status']=='failed' and result['failure']=='runner-result-invalid'
    assert not lease.exists()
`)
  })

  it('retains admission when local child termination cannot be confirmed', () => {
    offline(String.raw`
    fake.unconfirmed_process=True; fake.run_error=h.Refusal('child-process-group-not-terminated')
    result=serve(); assert result['status']=='cleanup-required' and lease.exists()
    assert 'delete' not in fake.calls
`)
  })

  it('bounds an actual child process group and suppresses child output from errors', () => {
    offline(String.raw`
    backend=h.Backend(root)
    script='import os,time; print("PRIVATE-CHILD-SENTINEL",flush=True); time.sleep(60)'
    try: backend.command([sys.executable,'-c',script],timeout=0.1)
    except subprocess.TimeoutExpired: pass
    else: raise AssertionError('timeout was accepted')
    assert not list(root.glob('child-*.log'))
    original=h.subprocess.Popen; children=[]
    def capture(*args,**kwargs):
        proc=original(*args,**kwargs); children.append(proc); return proc
    h.subprocess.Popen=capture
    try:
        backend.command([sys.executable,'-c',script],timeout=0.1)
    except subprocess.TimeoutExpired: pass
    finally: h.subprocess.Popen=original
    assert children[0].poll() is not None
    assert not h.Backend.group_running(children[0].pid), 'child process group survived'
`)
  })

  it('kills a descendant after its group leader exits and handles an actual signal', () => {
    offline(String.raw`
    backend=h.Backend(root)
    original=h.subprocess.Popen; children=[]
    def capture(*args,**kwargs):
        proc=original(*args,**kwargs); children.append(proc); return proc
    h.subprocess.Popen=capture
    script='import subprocess,sys,os; subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"]); os._exit(0)'
    try:
        backend.command([sys.executable,'-c',script],timeout=0.1)
    except subprocess.TimeoutExpired: pass
    else: raise AssertionError('descendant did not hold pipes')
    finally: h.subprocess.Popen=original
    assert children[0].returncode==0
    assert not h.Backend.group_running(children[0].pid), 'orphan descendant survived'
    def interrupted(*args): raise h.Refusal('signal')
    previous=signal.signal(signal.SIGTERM, interrupted)
    timer=threading.Timer(0.1,lambda: os.kill(os.getpid(),signal.SIGTERM)); timer.start()
    try:
        backend.command([sys.executable,'-c','import time; time.sleep(60)'])
    except h.Refusal as error: assert str(error)=='signal'
    else: raise AssertionError('signal not handled')
    finally: timer.join(); signal.signal(signal.SIGTERM,previous)
`)
  })
})
