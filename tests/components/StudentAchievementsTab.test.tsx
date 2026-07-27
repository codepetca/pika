import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'

describe('StudentAchievementsTab', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a bounded unavailable state when no Pal embed is configured', () => {
    render(<StudentAchievementsTab embedUrl={null} isActive />)

    expect(screen.getByRole('alert')).toHaveTextContent('Achievements are unavailable')
    expect(screen.queryByTitle('Pal achievements roadmap')).toBeNull()
  })

  it('hands a short-lived token only to the exact iframe origin and nonce', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'nonce-1' })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        token: 'short-lived-token',
        expires_at: '2026-09-16T18:25:00.000Z',
      }))))
    render(
      <StudentAchievementsTab
        embedUrl="https://pal.example.test/embed/roadmap"
        isActive
      />,
    )

    const frame = await screen.findByTitle('Pal achievements roadmap')
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://attacker.example.test',
        source: frame.contentWindow,
        data: { type: 'pal.embed.ready', nonce: 'nonce-1' },
      }))
    })
    expect(fetch).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://pal.example.test',
        source: frame.contentWindow,
        data: { type: 'pal.embed.ready', nonce: 'nonce-1' },
      }))
    })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/student/pal/read-token',
      expect.objectContaining({ method: 'POST' }),
    ))
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'pal.embed.authenticate',
        nonce: 'nonce-1',
        token: 'short-lived-token',
        theme: 'light',
      },
      'https://pal.example.test',
    ))

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://pal.example.test',
        source: frame.contentWindow,
        data: { type: 'pal.embed.authenticated', nonce: 'nonce-1' },
      }))
    })
    await waitFor(() =>
      expect(screen.queryByText('Loading achievements')).not.toBeInTheDocument())
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'pal.embed.appearance',
        nonce: 'nonce-1',
        theme: 'light',
      },
      'https://pal.example.test',
    ))
  })

  it('notifies an authenticated Pal frame when Pika changes theme', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'nonce-1' })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        token: 'short-lived-token',
        expires_at: '2026-09-16T18:25:00.000Z',
      }))))
    render(
      <StudentAchievementsTab
        embedUrl="https://pal.example.test/embed/roadmap"
        isActive
      />,
    )

    const frame = await screen.findByTitle('Pal achievements roadmap')
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://pal.example.test',
        source: frame.contentWindow,
        data: { type: 'pal.embed.ready', nonce: 'nonce-1' },
      }))
    })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pal.embed.authenticate' }),
      'https://pal.example.test',
    ))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://pal.example.test',
        source: frame.contentWindow,
        data: { type: 'pal.embed.authenticated', nonce: 'nonce-1' },
      }))
    })

    act(() => {
      document.documentElement.classList.add('dark')
    })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'pal.embed.appearance',
        nonce: 'nonce-1',
        theme: 'dark',
      },
      'https://pal.example.test',
    ))
    document.documentElement.classList.remove('dark')
  })

  it('offers a retry without navigating away when authentication fails', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('nonce-1')
      .mockReturnValueOnce('nonce-2') })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    render(
      <StudentAchievementsTab
        embedUrl="https://pal.example.test/embed/roadmap"
        isActive
      />,
    )

    const frame = await screen.findByTitle('Pal achievements roadmap')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'https://pal.example.test',
        source: frame.contentWindow,
        data: { type: 'pal.embed.ready', nonce: 'nonce-1' },
      }))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Achievements are temporarily unavailable',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByTitle('Pal achievements roadmap'))
        .toHaveAttribute('src', expect.stringContaining('nonce-2')))
  })
})
