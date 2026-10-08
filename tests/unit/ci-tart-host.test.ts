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
        self.calls=[]; self.vms=[{'Name':h.TEMPLATE,'Running':False}]; self.repository_ok=True
        self.fail_cleanup=False; self.run_error=None; self.steal=False; self.lease=None
    def repository_allowed(self): self.calls.append('repository'); return self.repository_ok
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
    def collect(self, vm): self.calls.append('collect'); return {'status':'collected','files':[]}
    def stop(self, vm, inspect=True):
        self.calls.append('stop')
        if not inspect: self.calls.append('stop-without-guest-inspection')
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
  it.each(['lease', 'child', 'stop', 'delete', 'inventory'])('independently revokes registration after %s cleanup failure', fault => {
    offline(String.raw`
    original=fake.run_one
    def fail(vm,idle,lifetime):
        outcome=original(vm,idle,lifetime)
        kind=${JSON.stringify(fault)}
        if kind=='lease': lease.unlink(); lease.write_text('foreign')
        if kind=='child': fake.unconfirmed_process=True
        if kind=='stop': fake.fail_cleanup=True
        if kind=='delete': fake.delete=lambda vm: (_ for _ in ()).throw(h.Refusal('delete-failed'))
        if kind=='inventory': fake.inventory=lambda: (_ for _ in ()).throw(h.Refusal('inventory-failed'))
        fake.calls.append('fault-applied')
        return outcome
    fake.run_one=fail
    revoked=[]; fake.unregister=lambda vm,identity: revoked.append((vm,identity))
    result=serve()
    assert result['status']=='cleanup-required' and lease.exists()
    assert len(revoked)==1 and revoked[0][1]['id']==7 and revoked[0][0]==revoked[0][1]['name']
    after=fake.calls[fake.calls.index('fault-applied')+1:]
    if ${JSON.stringify(fault)} in ('lease','child','inventory'):
        assert 'collect' not in after and result['diagnostics']['status']=='skipped'
    else: assert 'collect' in after
    if ${JSON.stringify(fault)} in ('lease','child'):
        assert not any(c in after for c in ('inventory','collect','stop','delete'))
    if ${JSON.stringify(fault)}=='lease': assert lease.read_text()=='foreign'
`)
  })

  it('cleans partial lease writes and handles the completed-acquisition handoff gap', () => {
    offline(String.raw`
    original=h.os.fsync
    for fault in ('fsync','write'):
        item=h.Lease(lease,'pika-ci-job-fault')
        if fault=='fsync': h.os.fsync=lambda fd: (_ for _ in ()).throw(h.Refusal('signal'))
        else:
            original_dump=h.json.dump; h.json.dump=lambda *args,**kwargs: (_ for _ in ()).throw(OSError('write-failed'))
        try: item.acquire()
        except (h.Refusal,OSError): pass
        else: raise AssertionError('fault not applied')
        finally:
            h.os.fsync=original
            if fault=='write': h.json.dump=original_dump
        assert not lease.exists()
        contender=h.Lease(lease,'pika-ci-job-retry'); contender.acquire(); contender.release()
    original_acquire=h.Lease.acquire
    def completed_then_signal(item): original_acquire(item); raise h.Refusal('signal')
    h.Lease.acquire=completed_then_signal
    try: result=serve()
    finally: h.Lease.acquire=original_acquire
    assert result['status']=='refused' and not lease.exists()
`)
  })

  it('preserves a replaced inode during failed acquisition', () => {
    offline(String.raw`
    original=h.os.fsync
    def replace(fd):
        replacement=root/'replacement'; replacement.write_text('foreign')
        os.replace(replacement,lease); raise h.Refusal('signal')
    h.os.fsync=replace
    try: h.Lease(lease,'pika-ci-job-fault').acquire()
    except h.Refusal: pass
    finally: h.os.fsync=original
    assert lease.read_text()=='foreign'
`)
  })

  it('rolls back a real pending signal delivered at lease publication', () => {
    offline(String.raw`
    previous=signal.signal(signal.SIGTERM,lambda *args: (_ for _ in ()).throw(h.Refusal('signal')))
    original=h.os.fsync
    def pending(fd): original(fd); os.kill(os.getpid(),signal.SIGTERM)
    h.os.fsync=pending
    try: result=serve()
    finally: h.os.fsync=original; signal.signal(signal.SIGTERM,previous)
    assert result['status']=='refused' and not lease.exists() and 'clone' not in fake.calls
    contender=h.Lease(lease,'pika-ci-job-later'); contender.acquire(); contender.release()
`)
  })

  it.each([0, 1])('contains closed-stdio descendants after leader exit %i', exit => {
    offline(String.raw`
    backend=h.Backend(root)
    original=h.subprocess.Popen; children=[]
    def capture(*args,**kwargs):
        proc=original(*args,**kwargs); children.append(proc); return proc
    h.subprocess.Popen=capture
    script='import subprocess,sys,os; subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); os._exit(${exit})'
    try:
        backend.command([sys.executable,'-c',script])
    except h.Refusal: assert ${exit} != 0
    finally:
        h.subprocess.Popen=original
        if h.Backend.group_running(children[0].pid):
            h.Backend.terminate(children[0]); raise AssertionError('closed-stdio descendant survived')
    assert not backend.unconfirmed_process
`)
  })

  it('preserves private diagnostics before disposal even after runner failure', () => {
    offline(String.raw`
    fake.run_error=h.Refusal('listener-failure')
    result=serve()
    assert result['diagnostics']['status']=='collected'
    assert fake.calls.index('unregister') < fake.calls.index('collect') < fake.calls.index('stop') < fake.calls.index('delete')
    assert 'PRIVATE-TOKEN-SENTINEL' not in json.dumps(result)
`)
  })

  it('observes the real listener failure after Worker activity', () => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    listener=client/'bin/Runner.Listener'
    listener.write_text('#!'+sys.executable+'\nimport pathlib,sys,time\npathlib.Path("_diag/Worker_test.log").write_text("PRIVATE-DIAGNOSTIC-SENTINEL")\ntime.sleep(0.15)\nsys.exit(1)\n'); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':2,'lifetime':3,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=5)
    assert result.returncode != 0 and 'PIKA_HOST_GUARD:listener-failure' in result.stdout
    assert 'PRIVATE-DIAGNOSTIC-SENTINEL' not in result.stdout
`)
  })

  it.each([0, 1, 2])('empties the actual guest group after leader exit %i with a closed-stdio descendant', exit => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    listener=client/'bin/Runner.Listener'
    body='import pathlib,subprocess,sys,os\np=pathlib.Path("attempts"); p.write_text(p.read_text()+"x" if p.exists() else "x")\npathlib.Path("group").write_text(str(os.getpgrp()))\nsubprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n'
    if ${exit}!=2: body+='pathlib.Path("_diag/Worker_test.log").write_text("activity")\n'
    listener.write_text('#!'+sys.executable+'\n'+body+'sys.exit(${exit})\n'); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':0.4 if ${exit}==2 else 2,'lifetime':3,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=6)
    pgid=int((client/'group').read_text())
    if h.Backend.group_running(pgid):
        os.killpg(pgid,signal.SIGKILL); raise AssertionError('guest descendant survived controller return')
    assert result.returncode != 0, 'surviving Worker must not produce success'
    assert (client/'attempts').read_text()=='x'
`)
  })

  it('routes uncertain guest containment directly to VM stop without new guest work', () => {
    offline(String.raw`
    fake.guest_unconfirmed=True; fake.run_error=h.Refusal('guest-process-group')
    result=serve()
    assert 'unregister' in fake.calls and 'collect' not in fake.calls
    assert 'stop-without-guest-inspection' in fake.calls and 'delete' in fake.calls
    assert result['diagnostics']['status']=='skipped' and not lease.exists()
    assert result['failure']=='guest-process-group'
`)
  })

  it('fails finitely when the actual guest controller cannot verify its exited group', () => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    listener=client/'bin/Runner.Listener'
    listener.write_text('#!'+sys.executable+'\nraise SystemExit(1)\n'); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    code=code.replace('forced=group_running(runner.pid)', "raise RuntimeError('PRIVATE-EXCEPTION-SENTINEL')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':2,'lifetime':3,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=5)
    assert result.returncode != 0 and 'PIKA_HOST_GUARD:process-group' in result.stdout
    assert 'PRIVATE-EXCEPTION-SENTINEL' not in result.stdout
`)
  })

  it('never deletes a preexisting registration when configuration was not issued', () => {
    offline(String.raw`
    backend=h.Backend(root); backend.runners=lambda: [{'id':99,'name':'pika-ci-job-preexisting'}]
    backend.guest=lambda *args,**kwargs: (_ for _ in ()).throw(AssertionError('configuration must not run'))
    backend.api=lambda *args,**kwargs: (_ for _ in ()).throw(AssertionError('foreign registration must not be deleted'))
    try: backend.register('pika-ci-job-preexisting','PRIVATE-TOKEN-SENTINEL')
    except h.Refusal as error: assert str(error)=='runner-name-already-exists'
    else: raise AssertionError('preexisting name was accepted')
    backend.unregister('pika-ci-job-preexisting',None)
    assert not backend.registration_issued
`)
  })

  it('does not weaken disposal when diagnostics fail and retains admission if revocation fails', () => {
    offline(String.raw`
    fake.collect=lambda vm: (_ for _ in ()).throw(h.Refusal('diagnostics-failed'))
    result=serve(); assert result['diagnostics']['status']=='failed'
    assert result['status']=='completed' and not lease.exists() and 'delete' in fake.calls
    fake.unregister=lambda vm,identity: (_ for _ in ()).throw(h.Refusal('revocation-failed'))
    result=serve(); assert result['status']=='cleanup-required' and lease.exists()
    assert result['registration_removed'] is False and fake.vms==[{'Name':h.TEMPLATE,'Running':False}]
`)
  })

  it('redacts and caps actual guest diagnostics while excluding config and symlinks', () => {
    offline(String.raw`
    import base64
    client=root/'client'; (client/'_diag').mkdir(parents=True)
    token='PRIVATE-TOKEN-SENTINEL'
    (client/'pika-host-run.log').write_text('PRIVATE-DIAGNOSTIC-SENTINEL '+token)
    for i in range(8): (client/'_diag'/('Worker_'+str(i)+'.log')).write_bytes((token.encode()+b'x')*10000)
    (client/'.credentials').write_text('FORBIDDEN-CREDENTIAL-CONTENT')
    code=h.GUEST_COLLECT.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'redactions':[token],'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=5)
    assert result.returncode==0, result.stderr
    data=json.loads(result.stdout); total=sum(len(base64.b64decode(f['data'])) for f in data['files'])
    assert total<=256*1024 and len(result.stdout)<512*1024
    assert all(token.encode() not in base64.b64decode(f['data']) for f in data['files'])
    assert not any(f['name'].startswith('.') for f in data['files'])
    backend=h.Backend(root); backend.redactions=[token]; backend.guest=lambda *args,**kwargs: result.stdout
    summary=backend.collect('pika-ci-job-offline')
    assert summary['bytes']==total and 'PRIVATE-DIAGNOSTIC-SENTINEL' not in json.dumps(summary)
    assert (root/'guest-diagnostics').stat().st_mode & 0o777==0o700
    assert all(p.stat().st_mode & 0o777==0o600 for p in (root/'guest-diagnostics').iterdir())
    assert len(data['files'])<=5, 'raw read budget exceeded before redaction'
    (client/'pika-host-run.log').unlink(); (client/'pika-host-run.log').symlink_to(client/'.credentials')
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=5)
    assert result.returncode != 0 and 'FORBIDDEN-CREDENTIAL-CONTENT' not in result.stdout
`)
  })

  it('latches containment failure for a nonzero child with closed-stdio descendants', () => {
    offline(String.raw`
    backend=h.Backend(root); original=h.subprocess.Popen; children=[]
    def capture(*args,**kwargs):
        proc=original(*args,**kwargs); children.append(proc); return proc
    h.subprocess.Popen=capture
    backend.terminate=lambda proc: (_ for _ in ()).throw(h.Refusal('unconfirmed'))
    script='import subprocess,sys,os; subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); os._exit(1)'
    try: backend.command([sys.executable,'-c',script])
    except h.Refusal: pass
    finally:
        h.subprocess.Popen=original; h.Backend.terminate(children[0])
    assert backend.unconfirmed_process
    assert backend.unconfirmed_groups==[{'pid':children[0].pid,'pgid':children[0].pid,'sequence':1}]
`)
  })

  it.each([0, 2, 3, 4])('never restarts listener exit %i after Worker activity', exit => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    listener=client/'bin/Runner.Listener'
    listener.write_text('#!'+sys.executable+'\nimport pathlib,sys\np=pathlib.Path("attempts"); p.write_text(p.read_text()+"x" if p.exists() else "x")\npathlib.Path("_diag/Worker_test.log").write_text("activity")\nsys.exit(${exit})\n'); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':2,'lifetime':3,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=5)
    assert (client/'attempts').read_text()=='x'
    assert (result.returncode==0)==(${exit}==0)
`)
  })

  it.each(['update', 'idle', 'lifetime'])('bounds guest %s handling before assignment', kind => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    kind=${JSON.stringify(kind)}
    listener=client/'bin/Runner.Listener'
    if kind=='update':
        body='p=pathlib.Path("attempts"); n=len(p.read_text()) if p.exists() else 0; p.write_text("x"*(n+1))\nif n==0: pathlib.Path("update.finished").write_text("ready"); sys.exit(4)\npathlib.Path("_diag/Worker_test.log").write_text("activity"); sys.exit(0)\n'
    else: body='pathlib.Path("attempts").write_text("x"); sys.exit(2)\n'
    listener.write_text('#!'+sys.executable+'\nimport pathlib,sys\n'+body); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':3 if kind=='lifetime' else 2 if kind=='update' else 0.3,'lifetime':0.3 if kind=='lifetime' else 3,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=5)
    if kind=='update': assert result.returncode==0 and (client/'attempts').read_text()=='xx'
    else:
        assert result.returncode != 0 and ('PIKA_HOST_GUARD:'+kind+'-timeout') in result.stdout
        assert (client/'attempts').read_text()=='x'
`)
  })

  it('waits for a real updater child to finish after its marker before restarting', () => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    updater='import pathlib,time; time.sleep(0.1); pathlib.Path("update.finished").write_text("ready"); time.sleep(0.3); pathlib.Path("updater-complete").write_text("done")'
    listener=client/'bin/Runner.Listener'
    body='import pathlib,subprocess,sys\np=pathlib.Path("attempts"); n=len(p.read_text()) if p.exists() else 0; p.write_text("x"*(n+1))\nif n==0:\n subprocess.Popen([sys.executable,"-c",'+repr(updater)+'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n sys.exit(4)\nif not pathlib.Path("updater-complete").exists(): sys.exit(1)\npathlib.Path("_diag/Worker_test.log").write_text("activity"); sys.exit(0)\n'
    listener.write_text('#!'+sys.executable+'\n'+body); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':3,'lifetime':4,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=6)
    assert result.returncode==0, result.stdout+result.stderr
    assert (client/'attempts').read_text()=='xx' and (client/'updater-complete').read_text()=='done'
`)
  })

  it('does not accumulate real pre-Worker retry descendants', () => {
    offline(String.raw`
    client=root/'client'; (client/'bin').mkdir(parents=True); (client/'_diag').mkdir()
    (client/'.runner').write_text(json.dumps({'agentName':'pika-ci-job-offline','ephemeral':True,'gitHubUrl':'https://github.com/codepetca/pika'}))
    listener=client/'bin/Runner.Listener'
    body='import pathlib,subprocess,sys,os\np=pathlib.Path("attempts"); n=len(p.read_text()) if p.exists() else 0; p.write_text("x"*(n+1))\nif n==0:\n pathlib.Path("old-group").write_text(str(os.getpgrp()))\n subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n sys.exit(2)\ngid=int(pathlib.Path("old-group").read_text()); rows=subprocess.check_output(["/bin/ps","-axo","pid=,pgid=,stat="],text=True)\nif any(int(p[1])==gid and not p[2].startswith("Z") for l in rows.splitlines() if len(p:=l.split())==3): sys.exit(1)\npathlib.Path("_diag/Worker_test.log").write_text("activity"); sys.exit(0)\n'
    listener.write_text('#!'+sys.executable+'\n'+body); listener.chmod(0o700)
    code=h.GUEST_RUN.replace("client=pathlib.Path('/home/runner/pika-actions-runner')", "client=pathlib.Path(payload['client'])").replace("require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')", "require(True,'identity')")
    payload={'client':str(client),'name':'pika-ci-job-offline','idle':8,'lifetime':9,'environment':dict(h.GUEST_ENV,HOME=str(root))}
    result=subprocess.run([sys.executable,'-c',code],input=json.dumps(payload),capture_output=True,text=True,timeout=9)
    gid=int((client/'old-group').read_text())
    if h.Backend.group_running(gid): os.killpg(gid,signal.SIGKILL); raise AssertionError('retry descendant survived')
    assert result.returncode==0 and (client/'attempts').read_text()=='xx', result.stdout+result.stderr
`)
  }, 10_000)

  it('prioritizes a finite guest containment failure and records owned host group recovery metadata', () => {
    offline(String.raw`
    backend=h.Backend(root)
    backend.guest=lambda *args,**kwargs: backend.command([sys.executable,'-c','print("PIKA_HOST_GUARD:idle-timeout"); print("PIKA_HOST_GUARD:process-group"); raise SystemExit(1)'],secret=True)
    try: backend.run_one('pika-ci-job-offline',1,2)
    except h.Refusal as error: assert str(error)=='guest-process-group'
    else: raise AssertionError('containment failure masked')
    assert backend.guest_unconfirmed and not backend.unconfirmed_process
    fake.unconfirmed_process=True; fake.unconfirmed_groups=[{'pid':123,'pgid':123,'sequence':5}]
    fake.run_error=h.Refusal('unconfirmed')
    result=serve(); receipt=json.loads(pathlib.Path(result['receipt']).read_text())
    assert receipt['host_unconfirmed_groups']==fake.unconfirmed_groups
    assert 'host_unconfirmed_groups' not in result and 'collect' not in fake.calls
`)
  })

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

  it('refuses an unexpected repository before boot, lease claim or token API', () => {
    offline(String.raw`
    fake.repository_ok=False
    result=serve()
    assert result['status']=='refused' and fake.calls==['repository']
    assert not lease.exists()
`)
  })

  it('accepts public and private Pika identities and rejects inconsistent or foreign metadata', () => {
    offline(String.raw`
    backend=h.Backend(root)
    for visibility, private in [('public', False), ('private', True)]:
        backend.api=lambda path: {'full_name':h.REPOSITORY,'visibility':visibility,'private':private}
        assert backend.repository_allowed()
    for data in [{'full_name':'someone/pika','visibility':'public','private':False},
                 {'full_name':h.REPOSITORY,'visibility':'public','private':True},
                 {'full_name':h.REPOSITORY,'visibility':'internal','private':True},
                 {'full_name':h.REPOSITORY}]:
        backend.api=lambda path: data
        assert not backend.repository_allowed()
`)
  })

  it('refuses fork, wrong-workflow and inactive demand before reading queued jobs', () => {
    offline(String.raw`
    backend=h.Backend(root)
    run={'path':'.github/workflows/ci.yml','head_repository':{'full_name':h.REPOSITORY},
         'event':'pull_request','status':'in_progress'}
    calls=[]
    def api(path):
        calls.append(path)
        if path.endswith('/jobs?per_page=100'):
            return {'jobs':[{'status':'queued','labels':['self-hosted','Linux','pika-ci']}]}
        return run
    backend.api=api
    assert backend.demand(123)
    for key, value in [('head_repository',{'full_name':'someone/pika'}),
                       ('path','.github/workflows/other.yml'),('event','pull_request_target'),
                       ('status','completed')]:
        original=run[key];run[key]=value;calls.clear()
        try: backend.demand(123)
        except h.Refusal as e: assert str(e)=='ineligible-demand'
        else: raise AssertionError('unsafe demand accepted')
        assert len(calls)==1
        run[key]=original
`)
  })

  it.each([2, 3])('rechecks repository identity before registration (check %s)', failedCheck => {
    offline(String.raw`
    checks=[]
    def repository_allowed():
        checks.append(1)
        return len(checks)!=${failedCheck}
    fake.repository_allowed=repository_allowed
    result=serve()
    assert result['status']=='failed' and result['failure']=='activation-recheck-refused'
    assert 'register' not in fake.calls and 'run_one' not in fake.calls
    assert not lease.exists() and fake.vms==[{'Name':h.TEMPLATE,'Running':False}]
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
    assert not any(c in fake.calls for c in ['repository','demand','token','register','run_one','unregister'])
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
