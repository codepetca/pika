// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  notifyImmediatePalDelivery,
  PIKA_PAL_REFRESH_EVENT,
} from '@/lib/pal-browser-events'

describe('Pal browser refresh events', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('notifies the mounted provider only for a newly delivered event', () => {
    const listener = vi.fn()
    window.addEventListener(PIKA_PAL_REFRESH_EVENT, listener)

    notifyImmediatePalDelivery('pending')
    notifyImmediatePalDelivery('already_delivered')
    notifyImmediatePalDelivery('delivered')

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(PIKA_PAL_REFRESH_EVENT, listener)
  })
})
