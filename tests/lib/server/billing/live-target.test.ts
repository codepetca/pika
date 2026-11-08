import { describe, expect, it, vi } from 'vitest'
import { checkBillingLiveTarget } from '@/lib/server/billing/live-target'

const projectRef = 'zhioqbapgfcrronyuidm'
const supabaseOrigin = 'https://' + projectRef + '.supabase.co'
const stripeAccount = 'acct_Preflight311'
const environment = {
  BILLING_LIVE_TARGET_CHECK_ENABLED: 'true',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca',
  NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin,
  STRIPE_LIVE_ACCOUNT_ID: stripeAccount,
}
const rpcPath = '/rest/v1/rpc/billing_attest_live_target_v1'
const requestUrl = supabaseOrigin + rpcPath + '?p_project_ref=' + projectRef + '&p_stripe_account=' + stripeAccount

describe('dormant live billing target check', () => {
  it('defaults off before building any transport', async () => {
    const read = vi.fn()
    await expect(checkBillingLiveTarget({ environment: {}, read })).resolves.toBe('disabled')
    await expect(checkBillingLiveTarget({
      environment: { ...environment, BILLING_LIVE_TARGET_CHECK_ENABLED: 'false' }, read,
    })).resolves.toBe('disabled')
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    { BILLING_SANDBOX_ENABLED: 'true' },
    { VERCEL: undefined },
    { VERCEL_ENV: 'preview' },
    { VERCEL_TARGET_ENV: 'preview' },
    { NEXT_PUBLIC_APP_URL: 'http://pika.codepet.ca' },
    { NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca.attacker.invalid' },
    { NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca/billing' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://' + 'b'.repeat(20) + '.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + ':443' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '/rest/v1' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '?redirect=elsewhere' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '#' },
    { STRIPE_LIVE_ACCOUNT_ID: 'malformed' },
    { STRIPE_LIVE_ACCOUNT_ID: undefined, STRIPE_ACCOUNT_ID: 'acct_Sandbox311' },
  ])('rejects a conflicting or unsafe environment before the reader is called', async override => {
    const read = vi.fn()
    await expect(checkBillingLiveTarget({ environment: { ...environment, ...override }, read }))
      .resolves.toBe('invalid_target')
    expect(read).not.toHaveBeenCalled()
  })

  it('attests only the exact production identity using a GET without redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('true'))
    const result = await checkBillingLiveTarget({
      environment: { ...environment, NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '/' },
      fetchImpl,
      async read(args, fetchRead) {
        expect(args).toEqual({ p_project_ref: projectRef, p_stripe_account: stripeAccount })
        return (await fetchRead(requestUrl)).json()
      },
    })
    expect(result).toBe('attested')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(requestUrl, expect.objectContaining({
      redirect: 'manual', signal: expect.any(AbortSignal),
    }))
  })

  it.each([
    [requestUrl, { method: 'POST' }],
    [requestUrl, { body: '{}' }],
    [requestUrl.replace('/rpc/', '/other/'), undefined],
    [requestUrl.replace(supabaseOrigin, 'https://other.invalid'), undefined],
    [requestUrl.replace(stripeAccount, 'acct_Other311'), undefined],
    [requestUrl + '&p_stripe_account=acct_Other311', undefined],
    [requestUrl + '&extra=value', undefined],
    [requestUrl + '#fragment', undefined],
  ] as const)('rejects any request outside the single read contract', async (url, init) => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(checkBillingLiveTarget({
      environment,
      fetchImpl,
      async read(_args, fetchRead) {
        await fetchRead(url, init)
        return true
      },
    })).resolves.toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed on redirects, transport errors and non-boolean replies', async () => {
    await expect(checkBillingLiveTarget({
      environment,
      fetchImpl: async () => new Response(null, { status: 302 }),
      async read(_args, fetchRead) {
        await fetchRead(requestUrl)
        return true
      },
    })).resolves.toBe('unavailable')
    const failedRead = vi.fn().mockRejectedValue(new Error('private diagnostic'))
    await expect(checkBillingLiveTarget({ environment, read: failedRead })).resolves.toBe('unavailable')
    for (const value of [false, null, { attested: true }, 'true']) {
      await expect(checkBillingLiveTarget({ environment, read: async () => value })).resolves.toBe('unavailable')
    }
  })
})
