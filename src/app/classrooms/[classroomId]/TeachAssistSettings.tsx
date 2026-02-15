'use client'

import { useCallback, useEffect, useState, useId } from 'react'
import { Info, Check } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { PageContent } from '@/components/PageLayout'
import type { Classroom } from '@/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  classroom: Classroom
}

type TAExecutionMode = 'confirmation' | 'full_auto'

interface ConfigState {
  ta_username: string
  ta_base_url: string
  ta_course_search: string
  ta_block: string
  ta_execution_mode: TAExecutionMode
  has_password: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeachAssistSettings({ classroom }: Props) {
  const isReadOnly = !!classroom.archived_at

  // --- Config form state ---
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://ta.yrdsb.ca/yrdsb/')
  const [courseSearch, setCourseSearch] = useState('')
  const [block, setBlock] = useState('')
  const [executionMode, setExecutionMode] = useState<TAExecutionMode>('confirmation')
  const [hasPassword, setHasPassword] = useState(false)
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [configSuccess, setConfigSuccess] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  // IDs for accessibility
  const usernameId = useId()
  const passwordId = useId()
  const baseUrlId = useId()
  const courseSearchId = useId()
  const blockId = useId()

  // --- Load config on mount ---
  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    setConfigError('')
    try {
      const res = await fetch(`/api/teacher/teachassist/config?classroom_id=${classroom.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load configuration')

      if (data.config) {
        setUsername(data.config.ta_username || '')
        setBaseUrl(data.config.ta_base_url || 'https://ta.yrdsb.ca/yrdsb/')
        setCourseSearch(data.config.ta_course_search || '')
        setBlock(data.config.ta_block || '')
        setExecutionMode(data.config.ta_execution_mode || 'confirmation')
        setHasPassword(!!data.config.has_password)
      }
      if (data.updated_at) setUpdatedAt(data.updated_at)
    } catch (err: any) {
      setConfigError(err.message || 'Failed to load configuration')
    } finally {
      setConfigLoading(false)
    }
  }, [classroom.id])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // --- Save config ---
  async function saveConfig() {
    if (isReadOnly) return

    // Validate required fields
    if (!username.trim()) { setConfigError('Username is required'); return }
    if (!hasPassword && !password.trim()) { setConfigError('Password is required'); return }
    if (!courseSearch.trim()) { setConfigError('Course search text is required'); return }
    if (!block.trim()) { setConfigError('Block is required'); return }

    setConfigSaving(true)
    setConfigError('')
    setConfigSuccess('')
    try {
      const body: Record<string, string> = {
        classroom_id: classroom.id,
        ta_username: username.trim(),
        ta_base_url: baseUrl.trim() || 'https://ta.yrdsb.ca/yrdsb/',
        ta_course_search: courseSearch.trim(),
        ta_block: block.trim(),
        ta_execution_mode: executionMode,
      }
      // Only send password if user typed a new one
      if (password.trim()) {
        body.ta_password = password.trim()
      }

      const res = await fetch('/api/teacher/teachassist/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save configuration')

      setConfigSuccess('Configuration saved.')
      setHasPassword(true)
      setPassword('') // Clear password field after save
      setTimeout(() => setConfigSuccess(''), 2000)
    } catch (err: any) {
      setConfigError(err.message || 'Failed to save configuration')
    } finally {
      setConfigSaving(false)
    }
  }

  // --- Config not loaded yet ---
  if (configLoading) {
    return (
      <PageContent className="space-y-5">
        <div className="text-sm text-text-muted">Loading TeachAssist configuration...</div>
      </PageContent>
    )
  }

  return (
    <PageContent className="space-y-5">

      {/* ----------------------------------------------------------------- */}
      {/* Configuration Card                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
        <div className="text-sm font-semibold text-text-default">TeachAssist Credentials</div>

        {/* Username */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label htmlFor={usernameId} className="text-sm text-text-default">Username</label>
            <Tooltip content="Your TeachAssist login username" side="right">
              <span className="text-text-muted cursor-help"><Info size={14} /></span>
            </Tooltip>
          </div>
          <input
            id={usernameId}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={configSaving || isReadOnly}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            placeholder="e.g. john.smith"
          />
        </div>

        {/* Password */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label htmlFor={passwordId} className="text-sm text-text-default">Password</label>
            {hasPassword && (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={configSaving || isReadOnly}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            placeholder={hasPassword ? 'Leave blank to keep current password' : 'Enter password'}
          />
        </div>

        {/* Base URL */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label htmlFor={baseUrlId} className="text-sm text-text-default">Base URL</label>
            <Tooltip content="The TeachAssist base URL for your school board" side="right">
              <span className="text-text-muted cursor-help"><Info size={14} /></span>
            </Tooltip>
          </div>
          <input
            id={baseUrlId}
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={configSaving || isReadOnly}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            placeholder="https://ta.yrdsb.ca/yrdsb/"
          />
        </div>

        {/* Course Search */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label htmlFor={courseSearchId} className="text-sm text-text-default">Course Search</label>
            <Tooltip content="Substring to match in the TA sidebar, e.g. GLD2OOH" side="right">
              <span className="text-text-muted cursor-help"><Info size={14} /></span>
            </Tooltip>
          </div>
          <input
            id={courseSearchId}
            type="text"
            value={courseSearch}
            onChange={(e) => setCourseSearch(e.target.value)}
            disabled={configSaving || isReadOnly}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            placeholder="e.g. GLD2OOH"
          />
        </div>

        {/* Block */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label htmlFor={blockId} className="text-sm text-text-default">Block</label>
            <Tooltip content="The period/block code in TeachAssist, e.g. A1" side="right">
              <span className="text-text-muted cursor-help"><Info size={14} /></span>
            </Tooltip>
          </div>
          <input
            id={blockId}
            type="text"
            value={block}
            onChange={(e) => setBlock(e.target.value)}
            disabled={configSaving || isReadOnly}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            placeholder="e.g. A1"
          />
        </div>

        {/* Execution Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-sm text-text-default">Execution Mode</div>
            <Tooltip content="Controls whether Pika submits attendance automatically or waits for you to review" side="right">
              <span className="text-text-muted cursor-help"><Info size={14} /></span>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="execution_mode"
                value="confirmation"
                checked={executionMode === 'confirmation'}
                onChange={() => setExecutionMode('confirmation')}
                disabled={configSaving || isReadOnly}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm text-text-default">Confirmation</div>
                <div className="text-xs text-text-muted">Fills the form and opens a browser window for you to review and click submit</div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="execution_mode"
                value="full_auto"
                checked={executionMode === 'full_auto'}
                onChange={() => setExecutionMode('full_auto')}
                disabled={configSaving || isReadOnly}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm text-text-default">Full Auto</div>
                <div className="text-xs text-text-muted">Runs headless and submits attendance automatically</div>
              </div>
            </label>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="primary"
            onClick={saveConfig}
            disabled={configSaving || isReadOnly}
            loading={configSaving}
          >
            {configSaving ? 'Saving...' : 'Save Configuration'}
          </Button>
          {updatedAt && (
            <span className="text-xs text-text-muted">
              Last saved: {new Date(updatedAt).toLocaleDateString('en-CA')}
            </span>
          )}
        </div>

        {configError && <div className="text-sm text-danger">{configError}</div>}
        {configSuccess && <div className="text-sm text-success">{configSuccess}</div>}
      </div>

      {/* Hint about syncing from the attendance tab */}
      <div className="text-xs text-text-muted">
        To sync attendance, go to the Attendance tab and use the &quot;Sync to TA&quot; button.
      </div>
    </PageContent>
  )
}
