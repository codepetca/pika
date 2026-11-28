/** Run only against the independently provisioned, labeled disposable target.
 * No container lifecycle or migrations. See test-http-mixed-load.md. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { appendFileSync, copyFileSync, cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sealData } from 'iron-session'
import { AUTH_SESSION_TTL_SECONDS, AUTH_SESSION_VERSION } from '../src/lib/auth-session-policy'
import { localPsqlArgs, validateTarget } from './test-contention-load'
import { runMixedHttpLoad, type MixedDispatch } from './test-http-mixed-load'

const q = (v: string) => `'${v.replaceAll("'", "''")}'`
const validId = (s: string) => /^[a-f0-9]{64}$/.test(s)
function inspect(id: string) {
  assert(validId(id))
  const p = spawnSync('docker', ['inspect', id], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(p.status, 0, 'container inspection failed')
  const result = JSON.parse(p.stdout); assert.equal(result.length, 1); assert.equal(result[0].Id, id)
  return result[0] as Parameters<typeof validateTarget>[0]
}
type Container = ReturnType<typeof inspect>
type Target = { db: string; api: string; owner: string; mode: 'standalone' } | { db: string; rest: string; kong: string; project: string; port: number; mode: 'supabase' }

/** A CLI project is accepted only with its exact, non-shared container names,
 * labels, network and REST-to-DB connection. No container is discovered by name. */
export function validateSupabaseContainers(db: Container, rest: Container, kong: Container, project: string, port: number) {
  assert.match(project, /^pika_test_load_(?:baseline|candidate)_[a-f0-9]{15,16}$/)
  assert(project.length <= 40)
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535)
  assert.equal(new Set([db.Id, rest.Id, kong.Id]).size, 3)
  const network = `supabase_network_${project}`
  for (const [container, role] of [[db, 'db'], [rest, 'rest'], [kong, 'kong']] as const) {
    assert.match(container.Id, /^[a-f0-9]{64}$/); assert(container.State.Running)
    assert.equal(container.Name, `/supabase_${role}_${project}`)
    assert.equal(container.Config.Labels?.['com.supabase.cli.project'], project)
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network])
  }
  assert.match(rest.Config.Image, /(?:^|\/)postgrest(?::|@)/)
  assert.match(kong.Config.Image, /(?:^|\/)kong(?::|@)/)
  const bindings = kong.NetworkSettings.Ports['8000/tcp']
  assert(bindings && (
    (bindings.length === 1 && bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === String(port)) ||
    (bindings.length === 2 && bindings.every(b => b.HostPort === String(port)) && new Set(bindings.map(b => b.HostIp)).size === 2 && bindings.some(b => b.HostIp === '0.0.0.0') && bindings.some(b => b.HostIp === '::'))
  ), 'Unexpected Kong API binding')
  assert(!rest.Config.Env.some(s => /^PG(?!RST_)[A-Z0-9_]+=/.test(s)))
  const uris = rest.Config.Env.filter(s => s.startsWith('PGRST_DB_URI=')); assert.equal(uris.length, 1)
  const uri = new URL(uris[0].slice('PGRST_DB_URI='.length))
  assert(['postgres:', 'postgresql:'].includes(uri.protocol)); assert.equal(uri.pathname, '/postgres')
  assert(uri.port === '' || uri.port === '5432'); assert.equal(uri.search, ''); assert.equal(uri.hash, '')
  const aliases = [db.Name.slice(1), ...(db.NetworkSettings.Networks[network].Aliases ?? [])]
  assert(aliases.includes(uri.hostname), 'REST database host is not the owned database')
}
export function validateSupabaseTarget(db: Container, rest: Container, kong: Container, project: string, port: number, kongConfig: string) {
  validateSupabaseContainers(db, rest, kong, project, port)
  const network = `supabase_network_${project}`
  const configEntries = kong.Config.Env.filter(s => s.startsWith('KONG_DECLARATIVE_CONFIG='))
  assert.deepEqual(configEntries, ['KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml'])
  // The CLI declarative config must contain exactly one /rest/v1 route and one
  // REST upstream. A project-local network alias binds that upstream to REST.
  const upstreams = [...kongConfig.matchAll(/^\s*url:\s*['"]?http:\/\/([a-zA-Z0-9_.-]+):3000\/?['"]?\s*$/gm)]
  assert.equal(upstreams.length, 1)
  assert([rest.Name.slice(1), ...(rest.NetworkSettings.Networks[network].Aliases ?? [])].includes(upstreams[0][1]))
  assert.equal([...kongConfig.matchAll(/^[ \t]*-[ \t]*['"]?\/rest\/v1\/['"]?[ \t]*$/gm)].length, 1)
  const restService = kongConfig.match(/^([ \t]*)- name:[ \t]*rest-v1[ \t]*\r?\n([\s\S]*?)(?=^\1- name:|$(?![\s\S]))/m)
  assert(restService && restService[2].includes(upstreams[0][0].trim()) && /^[ \t]*-[ \t]*['"]?\/rest\/v1\/['"]?[ \t]*$/m.test(restService[2]), 'Kong REST route is not bound to the owned upstream')
}
function target(t: Target) {
  if (t.mode === 'standalone') { validateTarget(inspect(t.db), inspect(t.api), t.owner); return }
  const db = inspect(t.db), rest = inspect(t.rest), kong = inspect(t.kong)
  validateSupabaseContainers(db, rest, kong, t.project, t.port)
  // Avoid printing Kong configuration: it may contain credentials.
  const config = spawnSync('docker', ['exec', t.kong, 'cat', '/home/kong/kong.yml'], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(config.status, 0, 'Kong configuration inspection failed')
  validateSupabaseTarget(db, rest, kong, t.project, t.port, config.stdout)
}
function sql(t: Target, command: string) {
  target(t)
  const p = spawnSync('docker', localPsqlArgs(t.db), { input: `set statement_timeout='20s';set lock_timeout='3s';\n${command}\n`, encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024 })
  // Database diagnostics can include data: never emit stderr.
  assert.equal(p.status, 0, 'disposable database operation failed')
  return p.stdout.trim()
}
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolveListen() }) })
  const address = server.address(); assert(address && typeof address !== 'string'); return address.port
}
async function close(server: Server) { await new Promise<void>((resolveClose, reject) => server.close(e => e ? reject(e) : resolveClose())) }

/** Only the Supabase REST path is forwarded; host and upstream are fixed, and
 * redirects are rejected instead of following an untrusted Location. */
export function isOwnedRestPath(path: string | undefined) {
  return typeof path === 'string' && path.startsWith('/rest/v1/') && !path.startsWith('//')
}
export function isAllowedAppPath(path: string) {
  return /^\/api\/(?:student|teacher)\/tests\/[a-f0-9-]+(?:\/[a-z-]+)?$/.test(path)
}
export function createOwnedGateway(rpcCounts = new Map<string, number>(), port = 54331, useKong = false,
  rpcErrors = new Map<string, number>(), learnerOperations = new Map<string, number>()) {
  return createServer((req, res) => {
    if (!isOwnedRestPath(req.url)) { res.writeHead(404).end(); return }
    const rpc = req.url!.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)(?:\?|$)/)?.[1]
    if (rpc) rpcCounts.set(rpc, (rpcCounts.get(rpc) ?? 0) + 1)
    let operationPrefix = ''
    if (rpc === 'test_learner_workflow_v1') {
      // Only the fixed operation value is counted. Never retain or print the body.
      req.on('data', (chunk: Buffer) => {
        if (operationPrefix.length < 512) operationPrefix += chunk.toString('utf8', 0, 512 - operationPrefix.length)
      })
    }
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path: useKong ? req.url! : req.url!.slice('/rest/v1'.length), method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` }, timeout: 20000 }, incoming => {
      if (rpc === 'test_learner_workflow_v1') {
        const operation = operationPrefix.match(/"p_operation"\s*:\s*"(inspect|detail|start|save|submit|recover|session|history|focus|results|document|history-plan|history-write)"/)?.[1] ?? 'unknown'
        operationPrefix = ''
        const key = `${operation}:${incoming.statusCode ?? 500}`
        learnerOperations.set(key, (learnerOperations.get(key) ?? 0) + 1)
      }
      if ((incoming.statusCode ?? 500) >= 300 && (incoming.statusCode ?? 500) < 400) { incoming.resume(); res.writeHead(502).end(); return }
      if (rpc && (incoming.statusCode ?? 500) >= 400) {
        let sample = ''
        incoming.on('data', (chunk: Buffer) => { if (sample.length < 1024) sample += chunk.toString('utf8', 0, 1024 - sample.length) })
        incoming.on('end', () => {
          const rpcCode = sample.match(/"code"\s*:\s*"((?:PT[0-9]{3}|PGRST[0-9]{3}|[0-9A-Z]{5}))"/)?.[1] ?? 'unknown'
          const reason = sample.match(/"message"\s*:\s*"(test_(?:learner|owner)_(?:invalid_input|invalid_deadline|invalid_focus_event|busy|deadline))"/)?.[1]
          const key = `${rpc}:${incoming.statusCode ?? 500}:${rpcCode}${reason ? `:${reason}` : ''}`
          rpcErrors.set(key, (rpcErrors.get(key) ?? 0) + 1)
        })
      }
      res.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(res)
    })
    res.on('close', () => upstream.destroy())
    upstream.on('timeout', () => upstream.destroy())
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
}
async function stopApp(child: ChildProcess) {
  if (!child.pid) return
  // The detached child owns the process group, including Next's worker.
  try { process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
  const exited = new Promise<void>(r => child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', () => r()))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([exited, new Promise<void>(r => { timer = setTimeout(r, 5000) })])
  if (timer) clearTimeout(timer)
  try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
  await exited
}
let stage = 'arguments'
let diagnosticPath: string | undefined
async function main() {
  const args = process.argv.slice(2)
  let selected: Target, countArg: string
  if (args[0] === '--supabase-project') {
    const [, project, db, rest, kong, port, count, ...extra] = args
    assert(project && db && rest && kong && port && count && extra.length === 0, 'Expected project, DB, REST, Kong, API port and learner count')
    selected = { mode: 'supabase', project, db, rest, kong, port: Number(port) }; countArg = count
  } else {
    const [db, api, owner, count, ...extra] = args
    assert(db && api && owner && count && extra.length === 0, 'Expected DB ID, API ID, owner token and learner count')
    selected = { mode: 'standalone', db, api, owner }; countArg = count
  }
  const count = Number(countArg); assert(Number.isInteger(count) && count >= 2 && count <= 40)
  const key = process.env.TEST_LOAD_SERVICE_KEY; assert(key, 'TEST_LOAD_SERVICE_KEY is required')
  stage = 'target-attestation'
  target(selected)
  const root = resolve(process.cwd()), scratch = mkdtempSync(join(tmpdir(), 'pika-http-load-'))
  const diagnosticDir = mkdtempSync(join(tmpdir(), 'pika-http-diagnostics-'))
  diagnosticPath = join(diagnosticDir, 'app.log')
  writeFileSync(diagnosticPath, '', { mode: 0o600 })
  let diagnosticBytes = 0
  const capture = (chunk: Buffer) => {
    const remaining = 512 * 1024 - diagnosticBytes
    if (remaining > 0) { const part = chunk.subarray(0, remaining); appendFileSync(diagnosticPath!, part); diagnosticBytes += part.length }
  }
  const rpcCounts = new Map<string, number>()
  const rpcErrors = new Map<string, number>()
  const learnerOperations = new Map<string, number>()
  const gateway = createOwnedGateway(rpcCounts, selected.mode === 'supabase' ? selected.port : 54331, selected.mode === 'supabase', rpcErrors, learnerOperations); let gatewayOpen = false, app: ChildProcess | undefined, fixtureAttempted = false, completed = false, cleanupVerified = false
  const marker = randomUUID(), teacher = randomUUID(), classrooms = [randomUUID(), randomUUID()]
  const tests = [randomUUID(), randomUUID(), randomUUID()], question = randomUUID()
  const learners = Array.from({ length: count }, () => randomUUID()), users = [teacher, ...learners]
  const tokens = users.map(() => randomBytes(32).toString('base64url'))
  const secret = randomBytes(32).toString('hex')
  try {
    // Next route discovery does not traverse a symlinked src directory. Copy
    // source into the env-free scratch project; link only public and dependencies.
    cpSync(join(root, 'src'), join(scratch, 'src'), { recursive: true })
    for (const name of ['public', 'node_modules']) symlinkSync(join(root, name), join(scratch, name))
    for (const name of ['package.json', 'next.config.js', 'tsconfig.json', 'postcss.config.js', 'tailwind.config.ts']) copyFileSync(join(root, name), join(scratch, name))
    stage = 'app-startup'
    const gatewayPort = await listen(gateway); gatewayOpen = true
    const portProbe = createServer(); const appPort = await listen(portProbe); await close(portProbe)
    app = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', scratch, '--hostname', '127.0.0.1', '--port', String(appPort)], {
      cwd: scratch, detached: true, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', VERCEL_GIT_COMMIT_SHA: 'disposable', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${gatewayPort}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'disposable-unused-publishable-key', SUPABASE_SECRET_KEY: key, SESSION_SECRET: secret, WORKOS_MAGIC_AUTH_PILOT: 'false',
        PIKA_CLASSROOM_EXPERIENCE_ADMISSION: JSON.stringify({ version: 1, admittedUserIds: users }),
      }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Readiness comes from our child, not a potentially unrelated listener.
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('owned app startup timeout')), 120000)
      const fail = () => { clearTimeout(timer); reject(new Error('owned app startup failed')) }
      app!.once('error', fail); app!.once('exit', fail)
      app!.stdout!.on('data', (chunk: Buffer) => { capture(chunk); if (String(chunk).includes('Ready')) { clearTimeout(timer); app!.off('exit', fail); resolveReady() } })
      app!.stderr!.on('data', capture)
    })
    stage = 'fixture-setup'
    assert.equal(sql(selected, `select (select count(*) from public.users where id in (${users.map(q).join(',')}))+(select count(*) from public.classrooms where id in (${classrooms.map(q).join(',')}))+(select count(*) from public.tests where id in (${tests.map(q).join(',')}));`), '0', 'fixture IDs unavailable')
    fixtureAttempted = true
    const code = (n: number) => `L${marker.replaceAll('-', '').slice(n, n + 7).toUpperCase()}`
    sql(selected, `begin;
insert into public.users(id,email,role) values ${users.map((id, i) => `(${q(id)},${q(`load-${marker}-${i}@example.invalid`)},${q(i ? 'student' : 'teacher')})`).join(',')};
insert into public.auth_sessions(user_id,token_hash,auth_source,credential_version,expires_at) values ${users.map((id, i) => `(${q(id)},${q(createHash('sha256').update(tokens[i]).digest('hex'))},'password',1,now()+interval '1 hour')`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code) values ${classrooms.map((id, i) => `(${q(id)},${q(teacher)},'Synthetic load',${q(code(i))})`).join(',')};
insert into public.classroom_enrollments(classroom_id,student_id) values ${learners.map(id => `(${q(classrooms[0])},${q(id)})`).join(',')};
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values ${tests.map((id, i) => `(${q(id)},${q(classrooms[i === 2 ? 1 : 0])},'Synthetic load','draft',1,${q(teacher)})`).join(',')};
insert into public.test_questions(id,test_id,question_type,question_text,options,points,position) values (${q(question)},${q(tests[0])},'open_response','Synthetic question','[]',1,0);
update public.tests set status='closed' where id in (${tests.map(q).join(',')});
insert into public.test_student_availability(test_id,student_id,state,updated_by)
values ${learners.map(id => `(${q(tests[0])},${q(id)},'open',${q(teacher)})`).join(',')};commit;`)
    const cookies = await Promise.all(tokens.map(async token => `pika_session=${await sealData({ auth: { token, version: AUTH_SESSION_VERSION } }, { password: secret, ttl: AUTH_SESSION_TTL_SECONDS })}`))
    const dispatch: MixedDispatch = async ({ method, path, cookie, body }) => {
      assert(isAllowedAppPath(path))
      const response = await fetch(`http://127.0.0.1:${appPort}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30000) })
      if (response.status >= 300 && response.status < 400) return { status: response.status, body: null }
      const text = await response.text()
      let responseBody: unknown = null
      try { responseBody = JSON.parse(text) } catch { /* retain the HTTP status, never log body */ }
      return { status: response.status, body: responseBody }
    }
    const warmRoutes = process.env.TEST_LOAD_WARM_ROUTES === '1'
    if (warmRoutes) {
      stage = 'warm-routes'
      const studentPath = `/api/student/tests/${tests[0]}`
      for (const [method, path] of [
        ['POST', `${studentPath}/start`], ['GET', `${studentPath}/session-status`],
        ['POST', `${studentPath}/focus-events`], ['PATCH', `${studentPath}/attempt`],
        ['POST', `${studentPath}/respond`], ['GET', `/api/teacher/tests/${tests[0]}/results`],
      ] as const) {
        const warm = await dispatch({ method, path, cookie: '' })
        assert.equal(warm.status, 401, 'Warm-up must decline the unauthenticated request')
      }
      assert.equal(rpcCounts.size, 0, 'Warm-up must not access Test RPCs')
    }
    stage = 'http-workload'
    const result = await runMixedHttpLoad({ learners: learners.map((studentId, i) => ({ studentId, cookie: cookies[i + 1] })), teacherCookie: cookies[0], testId: tests[0], questionId: question, sameClassTestId: tests[1], otherClassTestId: tests[2] }, dispatch)
    process.stdout.write(`${JSON.stringify({ phase: 'http', warmRoutes, summaries: result.summaries, rpcs: Object.fromEntries(rpcCounts), rpcErrors: Object.fromEntries(rpcErrors), learnerOperations: Object.fromEntries(learnerOperations) })}\n`)
    assert(result.expected, 'HTTP workload failed')
    assert((rpcCounts.get('test_learner_workflow_v1') ?? 0) >= count, 'Contextual learner path was not exercised')
    const compact = sql(selected, "select (to_regprocedure('public.read_test_session_for_member_v1(uuid,uuid,timestamp with time zone)') is not null)::text;")
    if (compact === 'true') {
      assert.equal(rpcCounts.get('read_test_session_for_member_v1'), count, 'Compact session path was not exercised')
    }
    stage = 'final-verification'
    const actual = JSON.parse(sql(selected, `select json_build_object('attempts',(select coalesce(json_agg(json_build_object('student',student_id,'responses',responses,'submitted',is_submitted) order by student_id),'[]') from public.test_attempts where test_id=${q(tests[0])}),'responses',(select coalesce(json_agg(json_build_object('student',student_id,'question',question_id,'text',response_text,'selected',selected_option) order by student_id),'[]') from public.test_responses where test_id=${q(tests[0])}),'focus',(select coalesce(json_agg(json_build_object('student',student_id,'event',event_type) order by student_id),'[]') from public.test_focus_events where test_id=${q(tests[0])}));`))
    const ordered = [...result.expected].sort((a, b) => a.studentId.localeCompare(b.studentId))
    assert.deepEqual(actual.attempts, ordered.map(e => ({ student: e.studentId, responses: e.responses, submitted: true })))
    assert.deepEqual(actual.responses, ordered.map(e => ({ student: e.studentId, question, text: e.responses[question].response_text, selected: null })))
    assert.deepEqual(actual.focus, ordered.map(e => ({ student: e.studentId, event: 'away_start' })))
    process.stdout.write(`${JSON.stringify({ phase: 'final-rows', verified: count })}\n`)
    completed = true
  } finally {
    if (app) await stopApp(app)
    if (gatewayOpen) await close(gateway)
    try {
      if (fixtureAttempted) {
        const previousStage = stage
        stage = 'cleanup'
        sql(selected, `begin;delete from public.classrooms where id in (${classrooms.map(q).join(',')}) and teacher_id=${q(teacher)};delete from public.users where ${users.map((id, i) => `(id=${q(id)} and email=${q(`load-${marker}-${i}@example.invalid`)})`).join(' or ')};commit;`)
        assert.equal(sql(selected, `select (select count(*) from public.users where id in (${users.map(q).join(',')}))+(select count(*) from public.classrooms where id in (${classrooms.map(q).join(',')}))+(select count(*) from public.tests where id in (${tests.map(q).join(',')}))+(select count(*) from public.test_attempts where test_id in (${tests.map(q).join(',')}))+(select count(*) from public.test_responses where test_id in (${tests.map(q).join(',')}))+(select count(*) from public.test_focus_events where test_id in (${tests.map(q).join(',')}));`), '0')
        cleanupVerified = true
        process.stdout.write(`${JSON.stringify({ phase: 'cleanup', verified: true })}\n`)
        stage = previousStage
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
      if (completed && cleanupVerified) { rmSync(diagnosticDir, { recursive: true, force: true }); diagnosticPath = undefined }
    }
  }
}
if (process.argv[1]?.endsWith('/test-http-mixed-launcher.ts')) main().catch(() => { console.error(`Mixed HTTP rehearsal failed during ${stage}; private app diagnostics: ${diagnosticPath ?? 'unavailable'}. Destroy the disposable target if cleanup was not verified.`); process.exitCode = 1 })
