import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Execute only the parsed pure query function with ctypes buffers and fake
// libproc calls. Never load libproc, enumerate PIDs, launch or signal a fixture.
const source = readFileSync(new URL('../../scripts/contextual-test-process-identity.py', import.meta.url), 'utf8')
const program = `import ast, ctypes as C, errno, json, sys, types
tree = ast.parse(sys.stdin.read())
query = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'query')
result = []
for before_flags, after_flags in [(0,0),(0,0x4000),(0x4000,0x4000),(0x4000,0)]:
    samples = iter([types.SimpleNamespace(pid=103,ppid=101,pgid=101,sec=123,usec=4,status=2,flags=flags) for flags in [before_flags,after_flags]])
    def path(pid,buf,size):
        buf.value = b'/cpu/image'
        return len(buf.value)
    namespace = dict(C=C,errno=errno,info=lambda pid: next(samples),lib=types.SimpleNamespace(proc_pidpath=path))
    exec(compile(ast.Module(body=[query],type_ignores=[]),'<pure-query>','exec'),namespace)
    result.append(namespace['query']([103,101,101]))
print(json.dumps(result))`

describe('kernel first-exec sampling with libproc doubles', () => {
  it('requires post-exec on both sides of the image sample', () => {
    const rows = JSON.parse(execFileSync('python3', ['-I', '-B', '-c', program], { input: source, encoding: 'utf8' }))
    expect(rows.map((row: { state: string }) => row.state)).toEqual(['starting', 'starting', 'alive', 'starting'])
    expect(rows[2].executable).toBe('/cpu/image')
    expect(rows.filter((row: { state: string }) => row.state === 'starting').every((row: { executable: string }) => row.executable === '')).toBe(true)
  })
})
