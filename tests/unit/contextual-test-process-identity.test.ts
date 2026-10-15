import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { reconcileOwnedFamily, type Capture, type OwnedProcessRow } from '../../scripts/contextual-test-process-ownership'

// AST-load only structures and pure functions. CDLL, native calls, PID inventory,
// fixture launches and signals are never executed by this test.
const source = readFileSync(new URL('../../scripts/contextual-test-process-identity.py', import.meta.url), 'utf8')
function query(overrides: object[] = [{}, {}], path = '/cpu/inherited'): OwnedProcessRow {
  const program = `import ast, ctypes as C, errno, json, sys, types
tree = ast.parse(sys.stdin.read())
selected = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))]
namespace = dict(C=C,errno=errno)
exec(compile(ast.Module(body=selected,type_ignores=[]),'<pure-query>','exec'),namespace)
samples = []
for override in json.loads(${JSON.stringify(JSON.stringify(overrides))}):
    fields = dict(pid=103,ppid=101,pgid=101,sec=123,usec=4,status=2,flags=0x4000,uniqueid=10301,puniqueid=10101,pidversion=9,uuid=bytes.fromhex('a'*32))
    fields.update(override)
    if isinstance(fields['uuid'], str): fields['uuid'] = bytes.fromhex(fields['uuid'])
    samples.append(types.SimpleNamespace(**fields))
samples = iter(samples)
def path(pid,buf,size):
    buf.value = ${JSON.stringify(path)}.encode()
    return len(buf.value)
namespace.update(info=lambda pid: next(samples),lib=types.SimpleNamespace(proc_pidpath=path))
print(json.dumps(namespace['query']([103,101,101])))`
  return JSON.parse(execFileSync('python3', ['-I', '-B', '-c', program], { input: source, encoding: 'utf8' }))
}

describe('private kernel lineage and image generation sampling with inert doubles', () => {
  it('does not interpret a first-exec flag as completed path publication', () => {
    const initial = query(), published = query([{}, {}], '/cpu/published')
    expect(initial).toMatchObject({ state: 'alive', uniqueId: '10301', parentUniqueId: '10101', imageUuid: 'a'.repeat(32), pidVersion: 9 })
    expect(initial.executable).toBe('/cpu/inherited')
    expect(published).toEqual({ ...initial, executable: '/cpu/published' })
    const identity = { pid: 101, pgid: 101, started: '123:1', uniqueId: '10101', imageUuid: 'b'.repeat(32), pidVersion: 2, executable: '/cpu/root', cwd: '/cpu', role: 'browser' as const }
    const root = { ...identity, ppid: 1, parentUniqueId: '1', state: 'alive' as const }
    const first = reconcileOwnedFamily({ identity, descendants: [] } satisfies Capture, [root, initial])
    expect(() => reconcileOwnedFamily(first, [root, published])).not.toThrow()
  })
  it.each([[0,0],[0,0x4000],[0x4000,0]])('retains only birth and parent proof when flags are %i/%i', (before, after) => {
    expect(query([{ flags: before }, { flags: after }])).toMatchObject({ state: 'starting', uniqueId: '10301', parentUniqueId: '10101', executable: '', imageUuid: '', pidVersion: null })
  })
  it.each(['uniqueid','puniqueid','pidversion','uuid','sec','pgid','ppid'])('rejects a torn %s sample without publishing identity values', field => {
    const changed = field === 'uuid' ? 'b'.repeat(32) : 999
    expect(query([{}, { [field]: changed }])).toEqual({ pid: 103, ppid: 101, pgid: 101, started: 'unverified', executable: '', uniqueId: '', parentUniqueId: '', imageUuid: '', pidVersion: null, state: 'unverified' })
  })
  it('rejects missing executable UUID and path', () => {
    expect(query([{ uuid: '0'.repeat(32) }, { uuid: '0'.repeat(32) }]).state).toBe('unverified')
    expect(query([{}, {}], '').state).toBe('unverified')
  })
  it('keeps a first-exec generation transition pending until it can be interpreted', () => {
    expect(query([{ flags: 0, uuid: 'b'.repeat(32), pidversion: 8 }, {}])).toMatchObject({ state: 'starting', uniqueId: '10301', parentUniqueId: '10101', imageUuid: '', pidVersion: null })
  })
  it('uses the pinned private ABI with an exact size return; unsupported results stay unverified', () => {
    const program = `import ast, ctypes as C, errno, json, sys, types
tree=ast.parse(sys.stdin.read())
namespace=dict(C=C,errno=errno)
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,(ast.ClassDef,ast.FunctionDef))],type_ignores=[]),'<pure-abi>','exec'),namespace)
calls=[]
returned = 191
def native(pid,flavor,arg,buf,size):
    calls.append([pid,flavor,arg,size])
    buf._obj.uniqueid=10301
    buf._obj.pid=103
    return returned
namespace['lib']=types.SimpleNamespace(proc_pidinfo=native)
assert namespace['info'](103) is None
returned = 192
accepted = namespace['info'](103)
assert accepted.pid == 103 and accepted.uniqueid == 10301
print(json.dumps(dict(sizes=[C.sizeof(namespace[k]) for k in ['BSD','Unique','BSDUnique']],calls=calls)))`
    expect(JSON.parse(execFileSync('python3', ['-I', '-B', '-c', program], { input: source, encoding: 'utf8' }))).toEqual({ sizes: [136, 56, 192], calls: [[103, 18, 0, 192], [103, 18, 0, 192]] })
  })
})
