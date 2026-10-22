'use client'

import { useState } from 'react'
import { Button, Card } from '@/ui'
import { SettingsSwitchRow } from '@/components/settings/SettingsSwitchRow'
import { TeacherGradebookVisibilityControl } from '@/components/gradebook/TeacherGradebookVisibilityControl'

/** Actual production owners with local state only; no settings or grade writes. */
export function SettingsSwitchMotionPattern() {
  const [enabled, setEnabled] = useState(false)
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)

  return (
    <section id="settings-switch-motion" aria-label="Settings switch motion">
      <Card tone="panel" padding="md">
        <h2 className="font-semibold">Settings switches</h2>
        <div className="mt-4 space-y-3">
          <SettingsSwitchRow
            checked={enabled}
            onChange={setEnabled}
            ariaLabel="Example setting"
            disabled={saving}
          >
            Example setting
          </SettingsSwitchRow>
          <div className="flex items-center gap-3">
            <TeacherGradebookVisibilityControl
              gradesVisible={visible}
              onChange={setVisible}
              saving={saving}
            />
            <span className="text-sm text-text-default">Grade visibility</span>
          </div>
          <Button variant="ghost" aria-pressed={saving} onClick={() => setSaving(value => !value)}>
            {saving ? 'Make switches available' : 'Simulate saving'}
          </Button>
        </div>
      </Card>
    </section>
  )
}
