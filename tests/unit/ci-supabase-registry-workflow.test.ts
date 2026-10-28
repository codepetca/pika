import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extractWorkflow, runLane, selectPlan } from '../../scripts/run-ci-local.mjs'

const workflow = () => readFileSync('.github/workflows/ci.yml', 'utf8')
const login = 'Authenticate Supabase image pulls'
const cleanup = 'Remove Supabase registry credentials'
const block = (source: string, name: string) => source.match(new RegExp(`^      - name: ${name}\\n[\\s\\S]*?(?=^      - name:|^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'))![0]
// Reconstruct the former authenticated shape from the current workflow so drift
// rejection remains covered without maintaining a second full workflow copy.
const authenticated = (source: string) => source
  .replace('SUPABASE_INTERNAL_IMAGE_REGISTRY: public.ecr.aws', 'SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io')
  .replace(/^(  (?:architecture-database-contracts(?:-lifecycle)?|contextual-test-owner-sdk(?:-lifecycle)?|browser-experience-matrix|browser-experience-dark|browser-pattern-lab-dark):\n    name: [^\n]+\n)/gm,
    '$1    permissions:\n      contents: read\n      packages: read\n')
  .replace(/(^      - name: Start ephemeral Supabase and replay migrations\n)/gm, `      - name: ${login}\n        id: supabase-registry-auth\n        env:\n          SUPABASE_CI_GHCR_TOKEN: \${{ github.token }}\n        run: node scripts/ci-supabase-registry-auth.mjs login\n\n$1`)
  .replace(/(^        run: supabase stop --no-backup\n)/gm, `$1\n      - name: ${cleanup}\n        id: supabase-registry-cleanup\n        if: always()\n        run: node scripts/ci-supabase-registry-auth.mjs cleanup\n`)

const historical = (source: string, registry = true) => registry ? source
  : source.replace(/^env:\n  SUPABASE_INTERNAL_IMAGE_REGISTRY: public.ecr.aws\n/m, '')

describe('Supabase CI registry contract', () => {
  it('uses official ECR without registry credentials or extra package permissions', () => {
    const source = workflow()
    const jobs = Object.values(extractWorkflow(source))
    expect(jobs.filter(job => job.lane !== 'test-build')).toHaveLength(7)
    expect(source).toMatch(/^permissions:\n  contents: read\n/m)
    expect(source).not.toMatch(/^    permissions:/m)
    expect(source).not.toContain('SUPABASE_CI_GHCR_TOKEN')
    expect(source).not.toContain('ci-supabase-registry-auth.mjs')
    for (const job of jobs) {
      expect(job.env.SUPABASE_INTERNAL_IMAGE_REGISTRY).toBe('public.ecr.aws')
      expect(job.steps.some(step => step.githubOnlyRegistry)).toBe(false)
    }
  })

  it('preserves the historical authenticated workflow contract', () => {
    const jobs = Object.values(extractWorkflow(authenticated(workflow())))
    const pullJobs = jobs.filter(job => job.lane !== 'test-build')
    expect(pullJobs).toHaveLength(7)
    for (const job of pullJobs) {
      expect(job.env.SUPABASE_INTERNAL_IMAGE_REGISTRY).toBe('ghcr.io')
      expect(job.permissions).toEqual({ contents: 'read', packages: 'read' })
      const auth = job.steps.find(step => step.name === login)!
      const remove = job.steps.find(step => step.name === cleanup)!
      const start = job.steps.findIndex(step => step.id === 'supabase-start')
      const stop = job.steps.findIndex(step => step.run === 'supabase stop --no-backup')
      expect(auth.githubOnlyRegistry).toBe('login')
      expect(remove.githubOnlyRegistry).toBe('cleanup')
      expect(job.steps.indexOf(auth)).toBeGreaterThan(job.steps.findIndex(step => step.id === 'ci-isolation'))
      expect(job.steps.indexOf(auth)).toBeLessThan(start)
      expect(job.steps.indexOf(remove)).toBe(stop + 1)
      expect(remove.if).toBe('always()')
      expect(auth.env).toEqual({})
    }
    expect(jobs.find(job => job.lane === 'test-build')!.steps.some(step => step.githubOnlyRegistry)).toBe(false)
  })

  it('keeps credentials and their cleanup out of local execution while retaining stack cleanup on failure', async () => {
    const job = selectPlan(extractWorkflow(authenticated(workflow())), 'browser')[0]
    const directory = mkdtempSync(join(tmpdir(), 'pika-registry-local-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const commands: string[] = []
    try {
      expect(await runLane(job, directory, directory, {}, {
        execute: async (script: string, _cwd: string, env: Record<string, string>, _child: unknown, path: string) => {
          commands.push(script)
          expect(env.SUPABASE_CI_GHCR_TOKEN).toBeUndefined()
          expect(env.PIKA_CI_REGISTRY_AUTH_DIR).toBeUndefined()
          writeFileSync(path, 'fake executor receipt\n')
          return script.startsWith('supabase start ') ? 1 : 0
        },
      })).toBe(true)
      expect(commands.some(command => command.includes('ci-supabase-registry-auth.mjs'))).toBe(false)
      expect(commands.filter(command => command === 'supabase stop --no-backup')).toHaveLength(1)
    } finally {
      log.mockRestore()
      error.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each(['secret', 'extra-env', 'changed-login', 'conditional-login', 'missing-cleanup', 'conditional-cleanup', 'changed-cleanup', 'duplicate-login', 'write-scope', 'missing-scope', 'wrong-registry'])(
    'rejects %s drift instead of accepting an arbitrary credential workflow', defect => {
      const source = authenticated(workflow())
      const auth = block(source, login), remove = block(source, cleanup)
      const changed = defect === 'secret' ? source.replace('${{ github.token }}', '${{ secrets.OTHER_TOKEN }}')
        : defect === 'extra-env' ? source.replace('          SUPABASE_CI_GHCR_TOKEN:', '          NODE_OPTIONS: --require=unreviewed\n          SUPABASE_CI_GHCR_TOKEN:')
        : defect === 'changed-login' ? source.replace('ci-supabase-registry-auth.mjs login', 'ci-supabase-registry-auth.mjs login --skip')
        : defect === 'conditional-login' ? source.replace(auth, auth.replace('        run:', '        if: success()\n        run:'))
        : defect === 'missing-cleanup' ? source.replace(remove, '')
        : defect === 'conditional-cleanup' ? source.replace(remove, remove.replace('if: always()', 'if: success()'))
        : defect === 'changed-cleanup' ? source.replace('ci-supabase-registry-auth.mjs cleanup', 'ci-supabase-registry-auth.mjs cleanup --skip')
        : defect === 'duplicate-login' ? source.replace(auth, auth + auth)
        : defect === 'write-scope' ? source.replace('      packages: read', '      packages: write')
        : defect === 'missing-scope' ? source.replace('      packages: read\n', '')
        : source.replace('SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io', 'SUPABASE_INTERNAL_IMAGE_REGISTRY: public.ecr.aws')
      expect(changed).not.toBe(source)
      expect(() => extractWorkflow(changed)).toThrow()
    },
  )

  it.each([true, false])('preserves historical unauthenticated plans (explicit registry=%s)', registry => {
    const jobs = extractWorkflow(historical(workflow(), registry))
    expect(selectPlan(jobs, 'all')).toHaveLength(8)
    expect(Object.values(jobs).flatMap(job => job.steps).some(step => step.githubOnlyRegistry)).toBe(false)
  })
})
