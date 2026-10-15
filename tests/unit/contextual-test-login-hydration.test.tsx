import { act, fireEvent, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ navigateTo: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => ({ get: () => null }) }))
vi.mock('@/lib/client-navigation', () => navigation)
vi.mock('../../scripts/contextual-test-rehearsal-binding', () => ({ readContextualTestBinding: vi.fn(), executeContextualTestSql: vi.fn() }))

import { LoginClient } from '@/app/login/LoginClient'
import { contextualTestLoginReady } from '../../e2e/helpers/contextual-test-runtime'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'

const plan = createContextualTestPlan('pika_assignment_list_012345abcdef')
const syntheticPassword = 'CPU-Synthetic-Login-Only'
let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ redirectUrl: '/classrooms' }) })))
  navigation.navigateTo.mockClear()
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined; container?.remove(); container = undefined
  vi.unstubAllGlobals(); vi.unstubAllEnvs()
})

describe('frozen login controlled-input hydration contract', () => {
  it('binds the imported component to the frozen bytes and a field-setter-only public preset', () => {
    const source = readFileSync(resolve('src/app/login/LoginClient.tsx'), 'utf8')
    // Owning/frozen files were compared before importing the owning alias.
    expect(createHash('sha256').update(source).digest('hex')).toBe('cbb4b6eca38850901964c00edd32b904af353e0128acc580385a0ce7746949e4')
    const setter = source.match(/function fillCredentials\(creds: \{ email: string; password: string \}\) \{([^}]+)\}/)?.[1]
    expect(setter?.replace(/\s/g, '')).toBe('setEmail(creds.email)setPassword(creds.password)')
    expect(source).toContain("teacher: { email: 'teacher@example.com', password: 'test1234' }")
    expect(source).toContain('onClick={() => fillCredentials(DEV_CREDENTIALS.teacher)}')
    expect(source).toContain('disabled={loading || !email || !password}')
  })

  it.each(['ownerTeacher', 'ownerStudent'] as const)('requires a public React transition before normal %s credential submission', async actor => {
    const element = <LoginClient />
    container = document.createElement('div')
    container.innerHTML = renderToString(element)
    document.body.append(container)
    const view = within(container)
    const email = view.getByLabelText('School Email') as HTMLInputElement
    const password = view.getByLabelText(/^Password(?:\s*\*)?$/) as HTMLInputElement
    const submit = view.getByRole('button', { name: 'Login', exact: true })
    // The browser can fill native server DOM before React attaches its owner.
    // No fixture value is logged or written to a DOM/screenshot artifact.
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    nativeValue.call(email, plan.actors[actor].email)
    nativeValue.call(password, syntheticPassword)
    email.dispatchEvent(new Event('input', { bubbles: true }))
    password.dispatchEvent(new Event('input', { bubbles: true }))
    expect(email.value.length > 0 && password.value.length > 0).toBe(true)
    expect(submit).toBeDisabled(); expect(contextualTestLoginReady()).toBe(false)
    fireEvent.click(submit)
    expect(fetch).not.toHaveBeenCalled()

    const recoverable = vi.fn()
    await act(async () => { root = hydrateRoot(container!, element, { onRecoverableError: recoverable }) })
    expect(recoverable).not.toHaveBeenCalled()
    expect(container.querySelector('input[type=email]')).toBe(email)
    expect(email.value.length > 0 && password.value.length > 0).toBe(true)
    expect(submit).toBeDisabled(); expect(contextualTestLoginReady()).toBe(false)

    // One ordinary public activation proves this mounted form's handlers ran.
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Teacher', exact: true })) })
    expect(contextualTestLoginReady()).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.change(email, { target: { value: plan.actors[actor].email } })
      fireEvent.change(password, { target: { value: syntheticPassword } })
    })
    expect(submit).toBeEnabled(); expect(contextualTestLoginReady()).toBe(false)
    await act(async () => { fireEvent.click(submit) })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: plan.actors[actor].email, password: syntheticPassword }),
    }))
    expect(navigation.navigateTo).toHaveBeenCalledWith('/classrooms')
  })
})
