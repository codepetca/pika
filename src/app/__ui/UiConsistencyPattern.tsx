'use client'

import { useState } from 'react'
import { SplitButton, Input, Card, PageDensityProvider } from '@/ui'
import { TeacherAssignmentStudentTable } from '@/components/assignment-workspace/TeacherAssignmentStudentTable'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'

const artifacts: AssignmentArtifact[] = [
  { type: 'link', url: 'https://example.invalid/demo', title: 'Demo', is_required_submission: true },
  { type: 'repo', url: 'https://example.invalid/source', title: 'Source' },
  { type: 'image', url: 'https://example.invalid/image', title: 'Image' },
]

/** Fixed data, actual production owners, and no API reads or writes. */
export function UiConsistencyPattern({ role }: { role: 'teacher' | 'student' }) {
  const [result, setResult] = useState('No action selected')
  return <section id="ui-consistency" className="space-y-4">
    <Card tone="panel" padding="md">
      <h2 className="font-semibold">Menu keyboard and artifact targets</h2>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <SplitButton label="Example actions" singleMenuTrigger menuPlacement="down" exitMotion="opacity" options={[
          { id: 'first', label: 'First action', onSelect: () => setResult('First selected') },
          { id: 'disabled', label: 'Unavailable action', disabled: true, onSelect: () => undefined },
          { id: 'last', label: 'Last action', onSelect: () => setResult('Last selected') },
        ]} />
        <Input aria-label="Text after menu" placeholder="Text after menu" className="w-48" />
        <span role="status">{result}</span>
      </div>
    </Card>
    {role === 'teacher' ? <Card tone="panel" padding="sm">
      <h3 className="mb-3 font-semibold">Assignment artifacts — tight table</h3>
      <PageDensityProvider density="teacher">
        <TeacherAssignmentStudentTable rows={[
          { student_id: 'example-one', student_email: 'one@example.invalid', student_first_name: 'Example', student_last_name: 'One', status: 'submitted_on_time', artifacts, doc: null },
          { student_id: 'example-two', student_email: 'two@example.invalid', student_first_name: 'Example', student_last_name: 'Two', status: 'submitted_on_time', artifacts: artifacts.slice(0, 1), doc: null },
        ]} selectedStudentId={null} onSelectStudent={() => undefined} onDeselectStudent={() => undefined}
          selectedIds={new Set()} onToggleSelect={() => undefined} onToggleSelectAll={() => undefined}
          allSelected={false} someSelected={false} sortColumn="first" sortDirection="asc" onToggleSort={() => undefined}
          dueAtMs={0} density="tight" loading={false} error="" />
      </PageDensityProvider>
    </Card> : null}
  </section>
}
