'use client'

import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function TeacherSettingsTab({ classroom }: Props) {
  const joinLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${classroom.class_code}`

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-600 mt-1">
          Classroom configuration and invite info.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-600">Join code</div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm">
            {classroom.class_code}
          </code>
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
            onClick={() => copy(classroom.class_code)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-600">Join link</div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm break-all">
            {joinLink}
          </code>
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
            onClick={() => copy(joinLink)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        Enrollment enable/disable toggle will be added in a later phase.
      </div>
    </div>
  )
}

