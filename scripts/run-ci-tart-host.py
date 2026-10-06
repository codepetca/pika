#!/usr/bin/env python3
"""On-demand, one-job Tart admission. Default invocation only prints a plan.

No migration replay, daemon, registration preparation, or stale-lease recovery.
Only the CLI constructs the real backend; offline tests inject a fake backend.
"""
import argparse
import base64
import json
import os
import pathlib
import platform
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

TART = '/opt/homebrew/bin/tart'
GH = '/opt/homebrew/bin/gh'
TEMPLATE = 'pika-ci-linux-template-prep'
REPOSITORY = 'codepetca/pika'
LEASE_PATH = pathlib.Path('/private/tmp/hq-books-deep-validation-host.lock')
RECEIPTS = pathlib.Path('/Users/stew/.codex/artifacts/pika/ci-tart-host')
ACTIVATION_ACK = 'PRIVATE_PIKA_ONE_JOB_RUNNER'
DOCKER_SOCKET = 'unix:///run/user/1002/docker.sock'
CLIENT = '/home/runner/pika-actions-runner'
GUEST_ENV = {
    'HOME': '/home/runner', 'USER': 'runner', 'LOGNAME': 'runner',
    'PATH': '/home/runner/bin:/opt/pika-ci/node-v24.12.0-linux-arm64/bin:/usr/local/bin:/usr/bin:/bin',
    'LANG': 'C.UTF-8', 'XDG_RUNTIME_DIR': '/run/user/1002',
}
GUEST_GUARDS = {'isolation', 'identity', 'client', 'credentials', 'host-mount', 'docker-context',
                'docker-socket', 'docker-rootless', 'toolchain', 'general-sudo', 'inventory'}


class Refusal(Exception):
    """Finite public failure code; child output/exception details stay private."""


def private_json(path, value):
    with open(path, 'x', encoding='utf8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


class Lease:
    def __init__(self, path, vm):
        self.path = pathlib.Path(path)
        self.record = {'owner': str(uuid.uuid4()), 'pid': os.getpid(), 'vms': [vm]}
        self.inode = None

    def acquire(self):
        try:
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            raise Refusal('host-lease-busy') from None
        self.inode = os.fstat(fd).st_ino
        with os.fdopen(fd, 'w') as stream:
            json.dump(self.record, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())

    def assert_owned(self):
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd) as stream:
                info = os.fstat(stream.fileno())
                if (info.st_ino != self.inode or not stat.S_ISREG(info.st_mode)
                        or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600):
                    raise Refusal('host-lease-ownership-changed')
                if json.load(stream) != self.record:
                    raise Refusal('host-lease-ownership-changed')
        except (OSError, ValueError):
            raise Refusal('host-lease-ownership-changed') from None

    def release(self):
        self.assert_owned()
        # Cooperative provisioners never replace a live lease; no age-based stealing.
        if self.path.lstat().st_ino != self.inode:
            raise Refusal('host-lease-ownership-changed')
        self.path.unlink()


# Static code is base64 encoded in argv to prevent Tart's shell expansion.
# Only the separately forwarded stdin JSON may contain a registration token.
GUEST_COMMON = r'''
import json, os, pathlib, platform, subprocess, sys, tempfile, time
payload=json.load(sys.stdin)
env=payload['environment']; os.environ.clear(); os.environ.update(env)
def call(args):
    return subprocess.check_output(args, env=env, stderr=subprocess.DEVNULL, text=True, timeout=30).strip()
def require(value, code='isolation'):
    if not value:
        print('PIKA_HOST_GUARD:'+code,flush=True)
        raise RuntimeError('guest-isolation-refused')
require(os.getuid()==1002 and platform.system()=='Linux' and platform.machine()=='aarch64','identity')
client=pathlib.Path('/home/runner/pika-actions-runner')
'''

GUEST_PREFLIGHT = GUEST_COMMON + r'''
require(client.is_dir() and not client.is_symlink(),'client')
require(not any((client / name).exists() for name in ('.runner','.credentials','.credentials_rsaparams','.service','.env')),'credentials')
require(not (client / '_work').exists() or not any((client / '_work').iterdir()))
require(not any((client / '_diag').glob('Worker_*.log')))
for p in ('/home/runner/.aws','/home/runner/.azure','/home/runner/.config/gcloud',
          '/home/runner/.config/gh','/home/runner/.ssh','/home/runner/.git-credentials',
          '/var/run/secrets','/var/run/docker.sock'):
    require(not pathlib.Path(p).exists(),'credentials')
for p in pathlib.Path('/home/runner').glob('.env*'): require(p.name=='.env.example')
processes=call(['ps','-u','1002','-o','args='])
require(not any(p in processes for p in ('Runner.Listener','Runner.Worker','runsvc.sh','./run.sh')))
require(not any(line.split()[2] in ('virtiofs','9p','nfs','nfs4','cifs') for line in pathlib.Path('/proc/mounts').read_text().splitlines()),'host-mount')
require(call(['docker','context','show'])=='pika-ci-rootless','docker-context')
context=json.loads(call(['docker','context','inspect','pika-ci-rootless']))
require(context[0]['Endpoints']['docker']['Host']=='unix:///run/user/1002/docker.sock','docker-socket')
require('name=rootless' in json.loads(call(['docker','info','--format','{{json .SecurityOptions}}'])),'docker-rootless')
config=pathlib.Path('/home/runner/.docker/config.json')
if config.exists():
    c=json.loads(config.read_text()); require(not c.get('auths') and not c.get('credsStore') and not c.get('credHelpers'))
require(call(['node','--version']).startswith('v24.'),'toolchain')
require(call(['pnpm','--version'])=='10.25.0' and call(['supabase','--version'])=='2.103.0','toolchain')
for tool in ('supabase','supabase-go'):
    target=pathlib.Path('/opt/pika-ci/supabase-2.103.0') / tool
    require((pathlib.Path('/home/runner/bin') / tool).resolve()==target,'toolchain')
    require(target.is_file() and target.stat().st_uid==0 and not target.stat().st_mode & 0o022,'toolchain')
require(subprocess.run(['sudo','-n','true'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10).returncode != 0,'general-sudo')
require(call([str(client / 'bin/Runner.Listener'),'--version']) in ('2.337.0','2.338.0'),'toolchain')
with tempfile.TemporaryDirectory(prefix='pika-host-preflight-') as d:
    script=pathlib.Path(d) / 'preflight.mjs'; script.write_text(payload['preflight'])
    for lane in ('database','browser','test-build'):
        subprocess.run(['node',str(script),'--lane',lane],cwd=d,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
print('READY')
'''

GUEST_CONFIGURE = GUEST_COMMON + r'''
require(not any((client / n).exists() for n in ('.runner','.credentials','.credentials_rsaparams','.env','.service')))
token=payload.pop('token'); require(isinstance(token,str) and 10 <= len(token) <= 2048)
config_env=dict(env, ACTIONS_RUNNER_INPUT_TOKEN=token)
subprocess.run(['./config.sh','--unattended','--ephemeral','--url','https://github.com/codepetca/pika',
                '--name',payload['name'],'--labels','pika-ci','--work','_work'],cwd=client,
               env=config_env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=90)
config=json.loads((client / '.runner').read_text())
require(config.get('gitHubUrl','').rstrip('/')=='https://github.com/codepetca/pika')
require(config.get('agentName')==payload['name'] and config.get('ephemeral') is True)
require(type(config.get('agentId')) is int and config['agentId']>0)
print(json.dumps({'id':config['agentId'],'name':config['agentName'],'ephemeral':True,'repo':'codepetca/pika'}))
'''

GUEST_RUN = GUEST_COMMON + r'''
import signal
config=json.loads((client / '.runner').read_text())
require(config.get('agentName')==payload['name'] and config.get('ephemeral') is True)
require(config.get('gitHubUrl','').rstrip('/')=='https://github.com/codepetca/pika')
# Runner logs are private guest files and are never returned to the host console.
log=client / 'pika-host-run.log'
fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as output:
    runner=subprocess.Popen(['./run.sh'],cwd=client,env=env,stdout=output,stderr=output,start_new_session=True)
    start=time.monotonic(); assigned=False
    while runner.poll() is None:
        assigned=assigned or any((client / '_diag').glob('Worker_*.log'))
        elapsed=time.monotonic()-start
        if elapsed>=payload['lifetime'] or (not assigned and elapsed>=payload['idle']):
            os.killpg(runner.pid,signal.SIGTERM)
            try: runner.wait(timeout=10)
            except subprocess.TimeoutExpired: os.killpg(runner.pid,signal.SIGKILL); runner.wait(timeout=5)
            raise RuntimeError('runner-lifetime-exceeded')
        time.sleep(1)
    require(runner.returncode==0 and assigned)
print(json.dumps({'runner_exit':runner.returncode,'assigned_job':None}))
'''

GUEST_EMPTY = GUEST_COMMON + r'''
require(call(['docker','context','show'])=='pika-ci-rootless')
context=json.loads(call(['docker','context','inspect','pika-ci-rootless']))
require(context[0]['Endpoints']['docker']['Host']=='unix:///run/user/1002/docker.sock')
require('name=rootless' in json.loads(call(['docker','info','--format','{{json .SecurityOptions}}'])))
for i in range(3):
    require(not call(['docker','ps','-aq']))
    require(not call(['docker','volume','ls','-q']))
    require(not call(['docker','network','ls','--filter','type=custom','--format','{{.ID}}']))
    time.sleep(0.25)
print('EMPTY')
'''


class Backend:
    def __init__(self, logs=None):
        self.logs = pathlib.Path(logs) if logs is not None else None
        self.sequence = 0
        self.vm_process = None
        self.unconfirmed_process = False

    @staticmethod
    def host_environment():
        return {'HOME': '/Users/stew', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'}

    def command(self, args, timeout=60, input_data=None, secret=False):
        self.sequence += 1
        # Secret-bearing stdin/API responses are never persisted, including errors.
        proc = subprocess.Popen(args, stdin=subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=self.host_environment(), start_new_session=True)
        try:
            out, err = proc.communicate(input_data.encode() if input_data is not None else None, timeout=timeout)
        except BaseException:
            self.contain(proc)
            raise
        # Preadmission read-only checks have no receipt directory yet.
        if not secret and self.logs is not None and self.logs.is_dir():
            path = self.logs / f'child-{self.sequence}.log'
            with open(path, 'xb') as stream:
                os.chmod(path, 0o600)
                stream.write(out + err)
        if proc.returncode:
            if secret:
                for line in out.decode('utf8', errors='replace').splitlines():
                    if line.startswith('PIKA_HOST_GUARD:') and line[16:] in GUEST_GUARDS:
                        raise Refusal('guest-' + line[16:])
            raise Refusal('child-command-failed')
        if len(out) > 512 * 1024:
            raise Refusal('child-output-too-large')
        return out.decode('utf8')

    def contain(self, proc):
        try:
            self.terminate(proc)
        except BaseException:
            self.unconfirmed_process = True
            raise

    @staticmethod
    def group_running(pgid):
        # Darwin can return EPERM for signal 0 on an already-empty process group.
        # Observe PIDs/group IDs/state without inspecting other processes' argv.
        rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,stat='],
                                       text=True, timeout=5, env=Backend.host_environment())
        return any(int(parts[1]) == pgid and not parts[2].startswith('Z')
                   for line in rows.splitlines() if len(parts := line.split()) == 3)

    @staticmethod
    def terminate(proc):
        # Descendants can survive their group leader; poll() alone is insufficient.
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            if Backend.group_running(proc.pid):
                raise Refusal('child-process-group-not-terminated') from None
            proc.wait(timeout=5)
            return
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            proc.poll()
            if not Backend.group_running(proc.pid):
                break
            time.sleep(0.02)
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                if Backend.group_running(proc.pid):
                    raise Refusal('child-process-group-not-terminated') from None
        proc.wait(timeout=5)
        deadline = time.monotonic() + 2
        while Backend.group_running(proc.pid):
            if time.monotonic() >= deadline:
                raise Refusal('child-process-group-not-terminated')
            time.sleep(0.02)

    def api(self, path, method='GET', secret=False):
        raw = self.command([GH, 'api', '--hostname', 'github.com', '--method', method,
                            '/repos/' + REPOSITORY + path], secret=secret)
        return json.loads(raw) if raw.strip() else None

    def private(self):
        data = self.api('')
        return data.get('full_name') == REPOSITORY and data.get('private') is True and data.get('visibility') == 'private'

    def demand(self, hint):
        if not hint or not re.fullmatch(r'[1-9][0-9]*', str(hint)):
            raise Refusal('run-id-required')
        run = self.api('/actions/runs/' + str(hint))
        if (run.get('path') != '.github/workflows/ci.yml'
                or run.get('head_repository', {}).get('full_name') != REPOSITORY
                or run.get('event') not in ('pull_request', 'workflow_dispatch')
                or run.get('status') not in ('queued', 'in_progress')):
            raise Refusal('ineligible-demand')
        jobs = self.api('/actions/runs/' + str(hint) + '/jobs?per_page=100')
        required = {'self-hosted', 'Linux', 'pika-ci'}
        return any(job.get('status') == 'queued' and required.issubset(set(job.get('labels', [])))
                   for job in jobs.get('jobs', []))

    def inventory(self):
        rows = json.loads(self.command([TART, 'list', '--format', 'json']))
        if not isinstance(rows, list) or any(not isinstance(r.get('Name'), str) or type(r.get('Running')) is not bool for r in rows):
            raise Refusal('invalid-vm-inventory')
        return rows

    def clone(self, vm):
        self.command([TART, 'clone', TEMPLATE, vm], timeout=120)
        self.command([TART, 'set', vm, '--cpu', '4', '--memory', '12288', '--random-mac'])

    def start(self, vm):
        fd = os.open(self.logs / 'tart-run.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:
            self.vm_process = subprocess.Popen([TART, 'run', '--no-graphics', '--no-audio', '--no-clipboard', vm],
                                               stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                               env=self.host_environment(), start_new_session=True)

    def guest(self, vm, code, payload=None, timeout=90):
        data = dict(payload or {}, environment=GUEST_ENV)
        encoded = base64.b64encode(code.encode()).decode()
        launcher = "exec(__import__('base64').b64decode('" + encoded + "'))"
        return self.command([TART, 'exec', '-i', vm, 'sudo', '-iu', 'runner', 'python3', '-c', launcher],
                            timeout=timeout, input_data=json.dumps(data), secret=True)

    def ready(self, vm):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.vm_process.poll() is not None:
                raise Refusal('vm-boot-failed')
            try:
                self.guest(vm, GUEST_COMMON + "\nprint('READY')\n", timeout=5)
                return
            except (Refusal, subprocess.TimeoutExpired):
                time.sleep(1)
        raise Refusal('vm-ready-timeout')

    def preflight(self, vm):
        source = pathlib.Path(__file__).with_name('ci-runner-preflight.mjs').read_text()
        if self.guest(vm, GUEST_PREFLIGHT, {'preflight': source}, timeout=150).strip() != 'READY':
            raise Refusal('guest-preflight-failed')

    def token(self):
        data = self.api('/actions/runners/registration-token', 'POST', secret=True)
        token = data.get('token')
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_\-]{10,2048}', token):
            raise Refusal('invalid-registration-token')
        return token

    def register(self, vm, token):
        if any(r.get('name') == vm for r in self.runners()):
            raise Refusal('runner-name-already-exists')
        identity = json.loads(self.guest(vm, GUEST_CONFIGURE, {'token': token, 'name': vm}, timeout=120))
        matches = [r for r in self.runners() if r.get('name') == vm]
        if (len(matches) != 1 or matches[0].get('id') != identity.get('id')
                or not {'self-hosted', 'Linux', 'pika-ci'}.issubset({l['name'] for l in matches[0].get('labels', [])})):
            raise Refusal('registration-binding-mismatch')
        return identity

    def runners(self):
        pages = json.loads(self.command([GH, 'api', '--hostname', 'github.com', '--paginate', '--slurp',
                                        '/repos/' + REPOSITORY + '/actions/runners?per_page=100']))
        return [runner for page in pages for runner in page['runners']]

    def run_one(self, vm, idle, lifetime):
        return json.loads(self.guest(vm, GUEST_RUN, {'name': vm, 'idle': idle, 'lifetime': lifetime}, timeout=lifetime + 30))

    def unregister(self, vm, identity):
        # Even a partially failed configure may have registered this unique name.
        matches = [r for r in self.runners() if r.get('name') == vm]
        if not matches:
            return
        if len(matches) != 1 or (identity and matches[0]['id'] != identity['id']):
            raise Refusal('orphan-registration-identity-mismatch')
        self.api('/actions/runners/' + str(matches[0]['id']), 'DELETE')

    def stop(self, vm):
        empty = False
        try:
            # No SQL or pruning: dirty resource state is contained by VM destruction.
            empty = self.guest(vm, GUEST_EMPTY, timeout=15).strip() == 'EMPTY'
        except (Refusal, subprocess.TimeoutExpired):
            pass
        self.command([TART, 'stop', vm])
        if self.vm_process is not None:
            self.contain(self.vm_process)
        return empty

    def delete(self, vm):
        if self.vm_process is not None:
            self.contain(self.vm_process)
        self.command([TART, 'delete', vm])


class HostDriver:
    def __init__(self, backend, lease_path=LEASE_PATH, receipt_root=RECEIPTS):
        self.backend = backend
        self.lease_path = pathlib.Path(lease_path)
        self.receipt_root = pathlib.Path(receipt_root)

    def execute(self, mode, acknowledgement='', run_id=None, idle=300, lifetime=7200):
        if mode not in ('plan', 'rehearse', 'serve-one'):
            raise Refusal('invalid-mode')
        if mode == 'plan':
            return {'status': 'plan', 'template': TEMPLATE, 'lease': str(self.lease_path),
                    'repository': REPOSITORY, 'registration': False, 'one_job': True,
                    'activation_acknowledgement': ACTIVATION_ACK}
        if mode == 'serve-one' and acknowledgement != ACTIVATION_ACK:
            raise Refusal('activation-acknowledgement-required')
        vm = 'pika-ci-job-' + uuid.uuid4().hex
        lease = Lease(self.lease_path, vm)
        result = {'status': 'refused', 'vm': vm, 'mode': mode, 'demand_run_id': run_id,
                  'assigned_job': None, 'registration': None, 'lease_released': False, 'stage': 'admission'}
        acquired = False
        attempted_clone = False
        attempted_registration = False
        try:
            if mode == 'serve-one':
                if not self.backend.private():
                    raise Refusal('repository-not-private')
                if not self.backend.demand(run_id):
                    raise Refusal('no-eligible-queued-job')
            lease.acquire()
            acquired = True
            result['stage'] = 'host-inventory'
            rows = self.backend.inventory()
            if any(r['Running'] for r in rows) or any(r['Name'] == vm for r in rows):
                raise Refusal('unexpected-running-vm')
            if not any(r['Name'] == TEMPLATE for r in rows):
                raise Refusal('template-unavailable')
            self.receipt_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.receipt_root.is_symlink() or self.receipt_root.stat().st_uid != os.getuid():
                raise Refusal('unsafe-receipt-root')
            os.chmod(self.receipt_root, 0o700)
            directory = self.receipt_root / vm
            directory.mkdir(mode=0o700)
            if isinstance(self.backend, Backend):
                self.backend.logs = directory
            lease.assert_owned()
            attempted_clone = True
            result['stage'] = 'clone'
            self.backend.clone(vm)
            lease.assert_owned()
            if any(r['Running'] for r in self.backend.inventory()):
                raise Refusal('unexpected-running-vm')
            result['stage'] = 'boot'
            self.backend.start(vm)
            self.backend.ready(vm)
            result['stage'] = 'guest-preflight'
            self.backend.preflight(vm)
            lease.assert_owned()
            if [r['Name'] for r in self.backend.inventory() if r['Running']] != [vm]:
                raise Refusal('unexpected-running-vm')
            if mode == 'serve-one':
                result['stage'] = 'registration'
                if not self.backend.private() or not self.backend.demand(run_id):
                    raise Refusal('activation-recheck-refused')
                token = self.backend.token()
                if not self.backend.private():
                    raise Refusal('activation-recheck-refused')
                lease.assert_owned()
                attempted_registration = True
                result['registration'] = self.backend.register(vm, token)
                del token
                identity = result['registration']
                if (identity.get('name') != vm or identity.get('repo') != REPOSITORY or identity.get('ephemeral') is not True
                        or type(identity.get('id')) is not int or identity['id'] <= 0):
                    raise Refusal('registration-binding-mismatch')
                result['stage'] = 'one-job'
                execution = self.backend.run_one(vm, idle, lifetime)
                if execution != {'runner_exit': 0, 'assigned_job': None}:
                    raise Refusal('runner-result-invalid')
                result.update(execution)
                result['status'] = 'completed'
            else:
                result['status'] = 'rehearsed'
        except (Exception, KeyboardInterrupt) as error:
            result['status'] = 'failed' if attempted_clone else 'refused'
            result['failure'] = str(error) if isinstance(error, Refusal) else 'interrupted-or-command-failed'
        finally:
            if acquired:
                try:
                    lease.assert_owned()
                    if getattr(self.backend, 'unconfirmed_process', False):
                        raise Refusal('child-process-group-not-terminated')
                    if attempted_clone:
                        own = [r for r in self.backend.inventory() if r['Name'] == vm]
                        if own:
                            if own[0]['Running']:
                                result['guest_empty'] = self.backend.stop(vm)
                                if result['guest_empty'] is False and result['status'] in ('completed', 'rehearsed'):
                                    result['status'] = 'failed'
                                    result['failure'] = 'guest-inventory-not-empty'
                            if any(r['Name'] == vm and r['Running'] for r in self.backend.inventory()):
                                raise Refusal('owned-vm-still-running')
                            self.backend.delete(vm)
                        if any(r['Name'] == vm for r in self.backend.inventory()):
                            raise Refusal('owned-vm-still-exists')
                    if attempted_registration:
                        self.backend.unregister(vm, result['registration'])
                    lease.release()
                    result['lease_released'] = True
                except (Exception, KeyboardInterrupt):
                    result['status'] = 'cleanup-required'
                    result['cleanup_failure'] = 'owned-teardown-or-lease-verification-failed'
            if attempted_clone:
                private_json(directory / 'receipt.json', result)
                result['receipt'] = str(directory / 'receipt.json')
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--rehearse', action='store_true')
    modes.add_argument('--serve-one', action='store_true')
    parser.add_argument('--ack', default='')
    parser.add_argument('--run-id', type=int)
    parser.add_argument('--idle-seconds', type=int, default=300)
    parser.add_argument('--lifetime-seconds', type=int, default=7200)
    args = parser.parse_args(argv)
    if not (30 <= args.idle_seconds <= 600 and args.idle_seconds <= args.lifetime_seconds <= 10800):
        parser.error('bounded idle/lifetime required (idle 30–600, lifetime <=10800)')
    mode = 'serve-one' if args.serve_one else 'rehearse' if args.rehearse else 'plan'
    if mode != 'plan' and (platform.system() != 'Darwin' or platform.machine() != 'arm64'
                           or pathlib.Path.home() != pathlib.Path('/Users/stew')):
        raise Refusal('fixed-mac-host-required')
    if mode == 'serve-one' and (args.ack != ACTIVATION_ACK or not args.run_id or args.run_id < 1):
        raise Refusal('activation-acknowledgement-and-run-id-required')
    def interrupted(signum, frame):
        raise Refusal('signal')
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    old_umask = os.umask(0o077)
    try:
        result = HostDriver(Backend()).execute(mode, args.ack, args.run_id,
                                                      args.idle_seconds, args.lifetime_seconds)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['status'] in ('plan', 'rehearsed', 'completed') else 1
    finally:
        os.umask(old_umask)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Refusal as error:
        print(json.dumps({'status': 'refused', 'failure': str(error)}))
        sys.exit(1)
