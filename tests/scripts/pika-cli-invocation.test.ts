import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'

const REPO_ROOT = resolve(__dirname, '../..')

type Invocation = {
  label: string
  mode: 'global' | 'package'
  prefix: 'pika' | 'pnpm pika'
}

const invocations: Invocation[] = [
  { label: 'global launcher', mode: 'global', prefix: 'pika' },
  { label: 'package script', mode: 'package', prefix: 'pnpm pika' },
]

function runCli(
  invocation: Invocation,
  args: string[],
  envOverrides: Record<string, string>
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env, ...envOverrides, PIKA_CLI_HOME: REPO_ROOT }
  delete env.PIKA_ORIGIN_PWD

  const command = invocation.mode === 'global' ? 'bash' : 'pnpm'
  const commandArgs = invocation.mode === 'global'
    ? [join(REPO_ROOT, 'scripts/pika-global.sh'), ...args]
    : ['--silent', 'pika', ...args]

  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: invocation.mode === 'global' ? envOverrides.PIKA_ORIGIN_PWD_TEST_CWD : REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolveRun({ code, stdout, stderr }))
  })
}

describe.each(invocations)('Pika CLI invocation hints via $label', (invocation) => {
  let server: Server
  let baseUrl: string
  let tempDir: string
  let sessionFile: string
  let missingSessionFile: string
  let blueprintDir: string

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pika-cli-invocation-'))
    sessionFile = join(tempDir, 'session.json')
    missingSessionFile = join(tempDir, 'missing-session.json')
    blueprintDir = join(tempDir, 'blueprint')
    mkdirSync(blueprintDir)
    writeFileSync(
      join(blueprintDir, 'manifest.json'),
      JSON.stringify({ version: '5', title: 'Invocation Test', course_code: 'INV-101' })
    )

    server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET' && request.url === '/api/teacher/classrooms/classroom-1') {
        response.end(JSON.stringify({
          classroom: { id: 'classroom-1', title: 'Invocation Class', archived_at: null },
        }))
        return
      }
      if (request.method === 'PATCH' && request.url === '/api/teacher/classrooms/classroom-1') {
        response.end(JSON.stringify({ classroom: { id: 'classroom-1' } }))
        return
      }
      if (request.method === 'GET' && request.url === '/api/teacher/classrooms') {
        response.statusCode = 401
        response.end(JSON.stringify({ error: 'expired' }))
        return
      }
      if (request.method === 'GET' && request.url === '/api/teacher/course-blueprints') {
        response.end(JSON.stringify({ blueprints: [] }))
        return
      }
      if (request.method === 'POST' && request.url === '/api/teacher/course-blueprints/import') {
        response.end(JSON.stringify({
          blueprint: { id: 'blueprint-1', title: 'Invocation Test' },
        }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: `Unhandled ${request.method} ${request.url}` }))
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
    writeFileSync(sessionFile, JSON.stringify({
      cookie: 'pika_session=test-session',
      baseUrl,
      savedAt: '2026-08-21T00:00:00.000Z',
    }))
  })

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose())
    })
    rmSync(tempDir, { recursive: true, force: true })
  })

  function cliEnv(path = sessionFile): Record<string, string> {
    return {
      PIKA_BASE_URL: baseUrl,
      PIKA_SESSION_FILE: path,
      PIKA_ORIGIN_PWD_TEST_CWD: tempDir,
    }
  }

  it('prints current, copy-pasteable help and Blueprint usage', async () => {
    const help = await runCli(invocation, ['help'], cliEnv())
    expect(help.code).toBe(0)
    expect(help.stdout).toContain(`  ${invocation.prefix} blueprint proposals <blueprintId>`)
    expect(help.stdout).toContain(`  ${invocation.prefix} blueprint apply <blueprintId> <proposalId> [--yes]`)
    expect(help.stdout).not.toContain(invocation.mode === 'global' ? 'pnpm pika ' : '\n  pika ')

    const usage = await runCli(invocation, ['blueprint', 'unknown'], cliEnv())
    expect(usage.code).toBe(1)
    expect(usage.stderr).toContain(
      `Usage: ${invocation.prefix} blueprint list | blueprint pull <id> <dir> | blueprint push <dir>`
    )
    expect(usage.stderr).toContain('blueprint proposals <id> | blueprint apply <id> <proposalId>')
    expect(usage.stderr).not.toContain('course pull')
    expect(usage.stderr).not.toContain('course push')
    expect(usage.stderr).not.toContain('course instantiate')
  }, 30_000)

  it('uses the invocation for missing and expired login recovery', async () => {
    const missing = await runCli(invocation, ['whoami'], cliEnv(missingSessionFile))
    expect(missing.code).toBe(0)
    expect(missing.stdout).toContain(`Run: ${invocation.prefix} login`)

    const expired = await runCli(invocation, ['classroom', 'list'], cliEnv())
    expect(expired.code).toBe(1)
    expect(expired.stderr).toContain(`Session expired or invalid. Run: ${invocation.prefix} login`)
  }, 30_000)

  it('uses the invocation in the archive Undo hint', async () => {
    const result = await runCli(
      invocation,
      ['classroom', 'archive', 'classroom-1', '--yes'],
      cliEnv()
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      `Undo with: ${invocation.prefix} classroom restore classroom-1 --yes`
    )
  }, 30_000)

  it('uses the invocation in the Blueprint import Next hint', async () => {
    const result = await runCli(
      invocation,
      ['blueprint', 'push', blueprintDir, '--new', '--yes'],
      cliEnv()
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      `Next: ${invocation.prefix} blueprint instantiate blueprint-1 --title "<classroom name>"`
    )
  }, 30_000)
})
