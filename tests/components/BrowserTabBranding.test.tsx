import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserTabProvider, ClassroomTabBranding } from '@/components/BrowserTabBranding'

const preference = vi.hoisted(() => ({ theme: 'light', mounted: true }))
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => preference }))

describe('browser tab branding', () => {
  beforeEach(() => {
    preference.theme = 'light'
    document.title = 'Pika'
    document.head.innerHTML = '<title>Pika</title><link id="pika-tab-icon" rel="icon" href="/pika-icon-light.svg"><meta id="pika-tab-color" name="theme-color" content="#f9fafb">'
  })

  it('uses a white Pika favicon in dark mode, including a manual theme change', async () => {
    const view = render(<BrowserTabProvider><div /></BrowserTabProvider>)
    preference.theme = 'dark'
    view.rerender(<BrowserTabProvider><div /></BrowserTabProvider>)
    await waitFor(() => expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/pika-icon-dark.svg'))
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#030712')
  })

  it('follows classroom switching and settings edits, then restores Pika on exit', async () => {
    const classroom = { id: 'first', title: 'Health for Life', theme_color: 'rose' as const }
    const view = render(<BrowserTabProvider><ClassroomTabBranding classroom={classroom} /></BrowserTabProvider>)
    await waitFor(() => expect(document.title).toBe('Health for Life'))
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/pika-icon-light.svg')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#f43f5e')

    preference.theme = 'dark'
    view.rerender(<BrowserTabProvider><ClassroomTabBranding classroom={classroom} /></BrowserTabProvider>)
    await waitFor(() => expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/pika-icon-dark.svg'))
    expect(document.title).toBe('Health for Life')
    view.rerender(<BrowserTabProvider><ClassroomTabBranding classroom={{ id: 'second', title: 'Computer Science', theme_color: 'violet' }} /></BrowserTabProvider>)
    await waitFor(() => expect(document.title).toBe('Computer Science'))
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#c084fc')
    view.rerender(<BrowserTabProvider><ClassroomTabBranding classroom={{ id: 'second', title: 'ICS4U — Introduction to Computer Science: Algorithms, Data Structures, and Software Design', theme_color: 'teal' }} /></BrowserTabProvider>)
    await waitFor(() => expect(document.title).toBe('ICS4U — Introduction to Computer Science: Algorithms, Data Structures, and Software Design'))
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/pika-icon-dark.svg')

    await act(async () => view.rerender(<BrowserTabProvider><div>Home</div></BrowserTabProvider>))
    expect(document.title).toBe('Pika')
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/pika-icon-dark.svg')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#030712')
  })
})
