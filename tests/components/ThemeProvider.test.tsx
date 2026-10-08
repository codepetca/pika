import { StrictMode, act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'

function Consumer() {
  const { theme, mounted, toggleTheme } = useTheme()
  return <><span>{mounted ? theme : 'initializing'}</span><input aria-label="Retained draft" defaultValue="draft" /><button onClick={toggleTheme}>Toggle theme</button></>
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

async function observeMount(run: () => void | Promise<void>) {
  const previousClasses: Array<string | null> = []
  const observer = new MutationObserver(records => previousClasses.push(...records.map(record => record.oldValue)))
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  try {
    await act(run)
    await Promise.resolve()
    return previousClasses
  } finally {
    observer.disconnect()
  }
}

describe('ThemeProvider initialization continuity', () => {
  it.each([false, true])('keeps the preinitialized dark root without a transient light reversal (StrictMode=%s)', async strict => {
    document.documentElement.className = 'dark'
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const content = <ThemeProvider><Consumer /></ThemeProvider>
    const classes = await observeMount(() => { render(strict ? <StrictMode>{content}</StrictMode> : content) })
    expect(screen.getByText('dark')).toBeVisible()
    expect(document.documentElement).toHaveClass('dark')
    expect(classes.every(value => value?.split(' ').includes('dark'))).toBe(true)
  })

  it('hydrates the same draft node and focus while preserving the selected dark theme', async () => {
    document.documentElement.className = 'dark'
    localStorage.setItem('theme', 'dark')
    const element = <ThemeProvider><Consumer /></ThemeProvider>
    const container = document.createElement('div')
    container.innerHTML = renderToString(element)
    document.body.append(container)
    const input = container.querySelector('input')!
    input.value = 'unsaved draft'
    input.focus()
    const recoverableErrors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    try {
      const classes = await observeMount(() => { root = hydrateRoot(container, element, { onRecoverableError: error => recoverableErrors.push(error) }) })
      expect(container.querySelector('input')).toBe(input)
      expect(input).toHaveValue('unsaved draft')
      expect(input).toHaveFocus()
      expect(container).toHaveTextContent('dark')
      expect(recoverableErrors).toEqual([])
      expect(classes.every(value => value?.split(' ').includes('dark'))).toBe(true)
    } finally {
      await act(() => root?.unmount())
      container.remove()
    }
  })

  it.each([
    ['dark', false, true],
    ['light', true, false],
    [null, true, true],
    [null, false, false],
  ] as const)('preserves stored=%s/systemDark=%s preference precedence', (stored, systemDark, dark) => {
    if (stored) localStorage.setItem('theme', stored)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: systemDark })))
    document.documentElement.className = dark ? 'dark' : ''
    render(<ThemeProvider><Consumer /></ThemeProvider>)
    expect(screen.getByText(dark ? 'dark' : 'light')).toBeVisible()
    expect(document.documentElement.classList.contains('dark')).toBe(dark)
    expect(document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light')
  })

  it('keeps the initialized dark fallback when preference storage is unavailable', async () => {
    document.documentElement.className = 'dark'
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    const classes = await observeMount(() => { render(<ThemeProvider><Consumer /></ThemeProvider>) })
    expect(screen.getByText('dark')).toBeVisible()
    expect(classes.every(value => value?.split(' ').includes('dark'))).toBe(true)
  })

  it('continues toggling and persisting theme without replacing or blurring the draft input', () => {
    document.documentElement.className = 'dark'
    render(<ThemeProvider><Consumer /></ThemeProvider>)
    const input = screen.getByRole('textbox', { name: 'Retained draft' })
    fireEvent.change(input, { target: { value: 'unsaved draft' } })
    input.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }))
    expect(screen.getByText('light')).toBeVisible()
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(screen.getByRole('textbox', { name: 'Retained draft' })).toBe(input)
    expect(input).toHaveValue('unsaved draft')
    expect(input).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }))
    expect(screen.getByText('dark')).toBeVisible()
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
