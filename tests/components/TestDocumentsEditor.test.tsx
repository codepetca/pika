import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'

describe('TestDocumentsEditor', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes document types as keyboard-navigable tabs without adding a panel tab stop', async () => {
    const user = userEvent.setup()
    render(<TestDocumentsEditor testId="test-1" isEditable />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))

    const linkTab = screen.getByRole('tab', { name: 'Link' })
    expect(linkTab).toHaveAttribute('aria-selected', 'true')
    expect(linkTab).toHaveAttribute('tabindex', '0')

    linkTab.focus()
    fireEvent.keyDown(linkTab, { key: 'End' })

    const textTab = screen.getByRole('tab', { name: 'Text' })
    expect(textTab).toHaveFocus()
    expect(textTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Text' })).not.toHaveAttribute('tabindex')

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveFocus()
  })

  it('uses one preallocated document id for managed upload and persisted ownership', async () => {
    const documentId = '10000000-0000-4000-8000-000000000001'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(documentId)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: 'https://example.test/material.pdf',
          title: 'material.pdf',
          managed_object_id: '20000000-0000-4000-8000-000000000002',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          test: {
            documents: [{
              id: documentId,
              title: 'material.pdf',
              source: 'upload',
              url: 'https://example.test/material.pdf',
              managed_object_id: '20000000-0000-4000-8000-000000000002',
            }],
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(<TestDocumentsEditor testId="test-1" isEditable />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['%PDF'], 'material.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload pdf document' }))

    await screen.findByText('material.pdf')
    const uploadBody = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(uploadBody.get('document_id')).toBe(documentId)
    const persisted = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(persisted.documents[0]).toEqual(expect.objectContaining({
      id: documentId,
      managed_object_id: '20000000-0000-4000-8000-000000000002',
    }))
  })
})
