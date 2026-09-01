'use client'

import { useState, type ReactNode } from 'react'
import { Info, RefreshCw } from 'lucide-react'
import {
  Button,
  Card,
  ConfirmDialog,
  FormField,
  Input,
  SaveStatus,
  SegmentedControl,
  Select,
  Tooltip,
  cn,
} from '@/ui'

type SettingsSection = 'general' | 'access' | 'features' | 'class-days' | 'reuse' | 'advanced'

const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'access', label: 'Access' },
  { value: 'features', label: 'Features' },
  { value: 'class-days', label: 'Class Days' },
  { value: 'reuse', label: 'Reuse' },
  { value: 'advanced', label: 'Advanced' },
]

function SettingsHeading({ title, tooltip }: { title: string; tooltip?: string }) {
  return (
    <div className="flex items-center gap-2">
      <h4 className="text-sm font-semibold text-text-default">{title}</h4>
      {tooltip ? (
        <Tooltip content={tooltip} side="right">
          <span tabIndex={0} className="cursor-help rounded-sm text-text-muted focus:outline-none focus:ring-foundation focus:ring-focus">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{tooltip}</span>
          </span>
        </Tooltip>
      ) : null}
    </div>
  )
}

function SettingsSwitchRow({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <Button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        variant="ghost"
        size="xs"
        className={cn(
          'h-11 w-14 shrink-0 p-0',
          disabled && 'opacity-60',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
          'relative block h-7 w-14 rounded-full border transition-colors',
          disabled
            ? 'cursor-not-allowed border-border bg-surface-2 opacity-60'
            : checked
              ? 'border-primary bg-info-bg hover:bg-info-bg-hover'
              : 'border-border bg-surface-2 hover:bg-surface-hover',
          )}
        >
          <span
            className={cn(
              'absolute left-0 top-1 h-5 w-5 rounded-full bg-primary shadow-sm transition-transform',
              checked ? 'translate-x-7' : 'translate-x-1',
            )}
          />
        </span>
      </Button>
      <span className={cn('min-w-0 text-sm', disabled ? 'text-text-muted' : 'text-text-default')}>
        <span className="block font-medium">{label}</span>
        {description ? <span className="block text-xs text-text-muted">{description}</span> : null}
      </span>
    </div>
  )
}

function SettingsPanel({ children }: { children: ReactNode }) {
  return <Card padding="md" className="space-y-3 shadow-none">{children}</Card>
}

export function SettingsMockup({ onPrototypeAction }: { onPrototypeAction: (action: string) => void }) {
  const [section, setSection] = useState<SettingsSection>('general')
  const [title, setTitle] = useState('Grade 10 Science')
  const [themeColor, setThemeColor] = useState('Blue')
  const [saveState, setSaveState] = useState<'saved' | 'unsaved'>('saved')
  const [allowJoins, setAllowJoins] = useState(true)
  const [rosterOnly, setRosterOnly] = useState(true)
  const [joinCode, setJoinCode] = useState('SCI2D')
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [features, setFeatures] = useState({ classwork: true, tests: true, gradebook: true, announcements: true })
  const [showMarkdown, setShowMarkdown] = useState(true)

  function recordSaved(action: string) {
    setSaveState('saved')
    onPrototypeAction(action)
  }

  return (
    <div className="space-y-3" data-testid="settings-mockup">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Classroom settings</h3>
          <p className="mt-0.5 text-xs text-text-muted">One section at a time; field changes save in place.</p>
        </div>
        <SaveStatus status={saveState} />
      </div>

      <div className="overflow-x-auto pb-1">
        <SegmentedControl
          ariaLabel="Settings section"
          value={section}
          onChange={setSection}
          options={SETTINGS_SECTIONS}
          className="min-w-max [&_button]:min-h-11"
        />
      </div>

      {section === 'general' ? (
        <div className="space-y-3">
          <SettingsPanel>
            <SettingsHeading title="Classroom name" tooltip="Name shown to students and in reports" />
            <FormField label="Classroom name" hideLabel>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setSaveState('unsaved')
                }}
                onBlur={() => recordSaved('Classroom name saved')}
              />
            </FormField>
          </SettingsPanel>
          <SettingsPanel>
            <SettingsHeading title="Display" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Classroom color">
              {['Blue', 'Green', 'Purple', 'Orange'].map((color) => (
                <Button
                  key={color}
                  type="button"
                  aria-pressed={themeColor === color}
                  onClick={() => {
                    setThemeColor(color)
                    recordSaved(`${color} classroom color selected`)
                  }}
                  variant={themeColor === color ? 'subtle' : 'surface'}
                  size="sm"
                  className={cn(
                    'w-full justify-between text-left',
                    themeColor === color && 'font-semibold text-primary',
                  )}
                >
                  {color}{themeColor === color ? <span className="text-xs">Selected</span> : null}
                </Button>
              ))}
            </div>
          </SettingsPanel>
        </div>
      ) : null}

      {section === 'access' ? (
        <div className="space-y-3">
          <SettingsPanel>
            <SettingsHeading title="Joining" tooltip="Control new joins and whether students must be on the roster" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <Button variant="subtle" aria-label="Copy join code" className="justify-start font-mono" onClick={() => onPrototypeAction('Join code copied')}>
                {joinCode}
              </Button>
              <Button variant="subtle" aria-label="Copy join link" className="min-w-0 flex-1 justify-start font-mono text-xs" onClick={() => onPrototypeAction('Join link copied')}>
                <span className="truncate">pika.school/join/{joinCode}</span>
              </Button>
              <Tooltip content="Generate new join code and link">
                <Button
                  type="button"
                  variant="secondary"
                  aria-label="Generate new join code and link"
                  className="h-11 w-11 shrink-0 border-warning bg-warning-bg px-0 text-warning"
                  onClick={() => setConfirmRegenerate(true)}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            </div>
            <div className="divide-y divide-border border-t border-border">
              <SettingsSwitchRow checked={allowJoins} onChange={(checked) => { setAllowJoins(checked); recordSaved(checked ? 'New joins allowed' : 'New joins disabled') }} label="Allow new joins" />
              <SettingsSwitchRow checked={rosterOnly} onChange={(checked) => { setRosterOnly(checked); recordSaved(checked ? 'Roster-only joining selected' : 'Open joining selected') }} label="Only students on roster can join" disabled={!allowJoins} />
            </div>
            {allowJoins && !rosterOnly ? <div className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">Anyone with this code or link can join after entering their name.</div> : null}
          </SettingsPanel>
          <SettingsPanel>
            <SettingsHeading title="Calendar visibility" tooltip="Control how far ahead students can see lesson plans" />
            <FormField label="Calendar visibility" hideLabel>
              <Select
                defaultValue="current_week"
                onChange={() => recordSaved('Calendar visibility saved')}
                options={[
                  { value: 'current_week', label: 'Current week (and all previous)' },
                  { value: 'one_week_ahead', label: '1 week ahead' },
                  { value: 'all', label: 'All (no restrictions)' },
                ]}
              />
            </FormField>
          </SettingsPanel>
        </div>
      ) : null}

      {section === 'features' ? (
        <SettingsPanel>
          <SettingsHeading title="Classroom features" tooltip="Choose which optional areas appear in this classroom" />
          <div className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">Daily, Roster, and Settings are always available. Hiding a feature does not delete its content.</div>
          <div className="divide-y divide-border">
            {([
              ['classwork', 'Classwork', 'Assignments, materials, and surveys'],
              ['tests', 'Tests', 'Assessments and responses'],
              ['gradebook', 'Gradebook', 'Teacher grading overview'],
              ['announcements', 'Announcements', 'Classroom updates'],
            ] as const).map(([key, label, description]) => (
              <SettingsSwitchRow
                key={key}
                checked={features[key]}
                onChange={(checked) => {
                  setFeatures((current) => ({ ...current, [key]: checked }))
                  recordSaved(`${label} visibility saved`)
                }}
                label={label}
                description={description}
                disabled={key === 'gradebook' && !features.classwork && !features.tests}
              />
            ))}
          </div>
        </SettingsPanel>
      ) : null}

      {section === 'class-days' ? (
        <SettingsPanel>
          <SettingsHeading title="Class Days" />
          <p className="text-sm text-text-muted">The full calendar remains the owner for teaching days. Use the Calendar mockup to review its date navigation and More actions.</p>
          <Button variant="secondary" onClick={() => onPrototypeAction('Calendar pattern referenced')}>Review calendar pattern</Button>
        </SettingsPanel>
      ) : null}

      {section === 'reuse' ? (
        <SettingsPanel>
          <SettingsHeading title="Course Blueprint" tooltip="Reuse teacher-authored course content in another classroom" />
          <p className="text-sm text-text-muted">Students, submissions, grades, attendance, and join codes are excluded.</p>
          <Button variant="secondary" onClick={() => onPrototypeAction('Save as Course Blueprint')}>Save as Course Blueprint</Button>
        </SettingsPanel>
      ) : null}

      {section === 'advanced' ? (
        <SettingsPanel>
          <SettingsHeading title="Markdown" />
          <SettingsSwitchRow checked={showMarkdown} onChange={(checked) => { setShowMarkdown(checked); recordSaved(checked ? 'Markdown shown' : 'Markdown hidden') }} label="Show markdown" description="Expose Markdown editing actions in supported work areas." />
        </SettingsPanel>
      ) : null}

      <p className="text-xs leading-5 text-text-muted">Settings use progressive disclosure and save beside the field being changed. Destructive or identity-changing operations still require confirmation.</p>

      <ConfirmDialog
        isOpen={confirmRegenerate}
        title="Generate new join code and link?"
        description="The current code and link will stop working."
        confirmLabel="Generate"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() => {
          setJoinCode((current) => current === 'SCI2D' ? 'PL9K2A' : 'SCI2D')
          setConfirmRegenerate(false)
          recordSaved('Join code regenerated')
        }}
      />
    </div>
  )
}
