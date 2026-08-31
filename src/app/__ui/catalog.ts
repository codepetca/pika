export type PatternMaturity = 'stable' | 'family' | 'experimental'

export interface PatternCatalogEntry {
  id: string
  name: string
  owner: string
  maturity: PatternMaturity
  useWhen: string
  avoidWhen: string
  reference: string
}

export const PATTERN_CATALOG: readonly PatternCatalogEntry[] = [
  {
    id: 'preview-action',
    name: 'Preview',
    owner: 'src/ui/IconButton.tsx + Lucide Eye',
    maturity: 'stable',
    useWhen: 'Previewing content in a dialog, workspace, or separate window. Use the eye-only button with a contextual tooltip.',
    avoidWhen: 'Navigating to an external destination; use ExternalLink. Keep preview routing and saving in the feature owner.',
    reference: 'src/ui/README.md#iconbutton',
  },
  {
    id: 'core-actions',
    name: 'Core actions',
    owner: 'src/ui/Button.tsx; src/ui/IconButton.tsx',
    maturity: 'stable',
    useWhen: 'A user initiates an immediate product action.',
    avoidWhen: 'The destination is navigation; use a link with clear destination text.',
    reference: 'src/ui/README.md#button',
  },
  {
    id: 'form-fields',
    name: 'Form fields',
    owner: 'src/ui/FormField.tsx',
    maturity: 'stable',
    useWhen: 'An input needs a label, hint, required marker, or validation message.',
    avoidWhen: 'A specialized browser control has an approved exception owner.',
    reference: 'src/ui/README.md#formfield-wraps-all-form-controls',
  },
  {
    id: 'content-surfaces',
    name: 'Content surfaces',
    owner: 'src/ui/Card.tsx',
    maturity: 'stable',
    useWhen: 'Content needs a bounded semantic surface or selected treatment.',
    avoidWhen: 'Spacing and a section heading provide enough hierarchy without another box.',
    reference: 'DESIGN.md#observed-visual-language',
  },
  {
    id: 'selection-controls',
    name: 'Tabs and segmented controls',
    owner: 'src/ui/Tabs.tsx; src/ui/SegmentedControl.tsx',
    maturity: 'stable',
    useWhen: 'Tabs switch panels or a small peer group changes display mode.',
    avoidWhen: 'The choice performs navigation or a one-time command.',
    reference: 'docs/guidance/ui/composite-control-conventions.md',
  },
  {
    id: 'save-feedback',
    name: 'Save feedback',
    owner: 'src/ui/SaveStatus.tsx',
    maturity: 'stable',
    useWhen: 'An editor needs persistent saved, saving, unsaved, or failed feedback.',
    avoidWhen: 'Feedback is a short global acknowledgement; use AppMessage.',
    reference: 'src/ui/README.md#appmessage',
  },
  {
    id: 'page-states',
    name: 'Page states',
    owner: 'src/ui/PageState.tsx',
    maturity: 'stable',
    useWhen: 'A route or primary work region is loading, failed, empty, or forbidden.',
    avoidWhen: 'Usable content remains visible during a non-blocking refresh.',
    reference: 'docs/guidance/ui/page-state-conventions.md',
  },
  {
    id: 'teacher-date-context',
    name: 'Shared date navigation',
    owner: 'src/components/DateNavigator.tsx',
    maturity: 'family',
    useWhen: 'A teacher date scope needs the shared previous/date/next control structure, spacing, and accessible labels.',
    avoidWhen: 'Relative-date text is Daily-only. Do not copy it, Daily saved preferences, picker behavior, or attendance commands into other pages.',
    reference: 'src/app/classrooms/[classroomId]/TeacherAttendanceTab.tsx; src/components/CalendarActionBar.tsx',
  },
  {
    id: 'teacher-workspace-frame',
    name: 'Teacher workspace framing',
    owner: 'src/components/teacher-work-surface/TeacherWorkSurfaceShell.tsx',
    maturity: 'family',
    useWhen: 'A teacher work surface needs standalone action-bar spacing or tabs attached to a selected workspace.',
    avoidWhen: 'Adding workspace tabs or a passive inspector before selecting work, or forcing teacher density onto student work.',
    reference: 'docs/guidance/ui/teacher-work-surfaces.md#implemented-primitive-map',
  },
  {
    id: 'attendance-status-counts',
    name: 'Attendance colors and count chips',
    owner: 'src/app/classrooms/[classroomId]/TeacherAttendanceControls.tsx',
    maturity: 'family',
    useWhen: 'Present, Late, and Absent counts help teachers prioritize rows. Use colored, number-only pills with contextual tooltips.',
    avoidWhen: 'Do not add status icons to count chips, treat sorting as filtering, or infer attendance from Daily log completion.',
    reference: 'docs/guidance/ui/teacher-operational-tables.md#status-count-sorting',
  },
  {
    id: 'assessment-status-colors',
    name: 'Assessment status colors',
    owner: 'src/components/AssessmentStatusIndicator.tsx',
    maturity: 'family',
    useWhen: 'Classwork, Tests, or Gradebook need their existing work-status labels and semantic colors.',
    avoidWhen: 'Do not collapse Graded into Returned or confuse actions such as Grade and Return with status labels.',
    reference: 'src/app/__ui/StatusPatterns.tsx',
  },
  {
    id: 'status-language',
    name: 'Semantic status language',
    owner: 'Feature owner plus semantic tokens',
    maturity: 'experimental',
    useWhen: 'A state needs a consistent label, symbol, and semantic tone.',
    avoidWhen: 'A domain already owns a more precise status contract.',
    reference: 'DESIGN.md#semantic-color-and-themes',
  },
] as const

export type ApprovedIconName =
  | 'check-circle'
  | 'clock'
  | 'alert-circle'
  | 'info'
  | 'lock'
  | 'loader'
  | 'inbox'
  | 'pencil'
  | 'trash'
  | 'external-link'
  | 'chevron-down'
  | 'menu'
  | 'plus'
  | 'refresh'
  | 'more-actions'
  | 'eye'

export interface IconCatalogEntry {
  id: ApprovedIconName
  label: string
  category: 'status' | 'action' | 'navigation'
  meaning: string
  rule: string
}

export const ICON_CATALOG: readonly IconCatalogEntry[] = [
  { id: 'eye', label: 'Eye', category: 'action', meaning: 'Preview content', rule: 'Use an icon-only Preview button with a contextual tooltip and accessible name, even when the preview opens a separate window.' },
  { id: 'plus', label: 'Plus', category: 'action', meaning: 'Create a new item', rule: 'Use an icon-only creation entry point with a contextual tooltip and accessible name. Keep menu choices and form confirmations explicit.' },
  { id: 'refresh', label: 'RotateCw', category: 'action', meaning: 'Retry loading', rule: 'Use for a safe read retry, retaining the accessible name and tooltip.' },
  { id: 'more-actions', label: 'MoreVertical', category: 'action', meaning: 'More actions', rule: 'Place the PageActionBar overflow at the far right at every width; keep primary actions visible.' },
  {
    id: 'check-circle',
    label: 'CheckCircle2',
    category: 'status',
    meaning: 'Completed or confirmed',
    rule: 'Pair with a visible label unless the surrounding content already names the state.',
  },
  {
    id: 'clock',
    label: 'Clock3',
    category: 'status',
    meaning: 'Pending, scheduled, or time-sensitive',
    rule: 'Use the product label to distinguish pending from scheduled.',
  },
  {
    id: 'alert-circle',
    label: 'CircleAlert',
    category: 'status',
    meaning: 'Failed or needs attention',
    rule: 'Explain the problem and recovery action; never rely on the symbol alone.',
  },
  {
    id: 'info',
    label: 'Info',
    category: 'status',
    meaning: 'Neutral supporting information',
    rule: 'Do not use it as decoration when the copy is already self-evident.',
  },
  {
    id: 'lock',
    label: 'LockKeyhole',
    category: 'status',
    meaning: 'Unavailable or restricted',
    rule: 'Use intentionally indistinguishable copy for protected resources when required.',
  },
  {
    id: 'loader',
    label: 'LoaderCircle',
    category: 'status',
    meaning: 'Work is actively in progress',
    rule: 'Expose a text status and a reduced-motion path.',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    category: 'status',
    meaning: 'A successful read returned no records',
    rule: 'Never substitute it for an error or forbidden state.',
  },
  {
    id: 'pencil',
    label: 'Pencil',
    category: 'action',
    meaning: 'Edit the named item',
    rule: 'Icon-only use requires an accessible name, tooltip, and full control target.',
  },
  {
    id: 'trash',
    label: 'Trash2',
    category: 'action',
    meaning: 'Delete or remove',
    rule: 'Use danger treatment and confirmation when the effect is broad or irreversible.',
  },
  {
    id: 'external-link',
    label: 'ExternalLink',
    category: 'action',
    meaning: 'Open an external destination or separate context',
    rule: 'The link text still names the destination. Preview actions use Eye instead, even in a separate window.',
  },
  {
    id: 'chevron-down',
    label: 'ChevronDown',
    category: 'navigation',
    meaning: 'Reveal a menu or collapsed region',
    rule: 'Do not use as a substitute for state text or a selection label.',
  },
  {
    id: 'menu',
    label: 'Menu',
    category: 'navigation',
    meaning: 'Open responsive navigation',
    rule: 'Use only when the destination set is hidden at the current viewport.',
  },
] as const

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusCatalogEntry {
  id: string
  label: string
  tone: StatusTone
  icon: ApprovedIconName
  meaning: string
  usage: string
}

export const STATUS_CATALOG: readonly StatusCatalogEntry[] = [
  {
    id: 'complete',
    label: 'Complete',
    tone: 'success',
    icon: 'check-circle',
    meaning: 'The requested work finished successfully.',
    usage: 'Use a domain-specific label such as Submitted when that is more precise.',
  },
  {
    id: 'needs-attention',
    label: 'Needs attention',
    tone: 'warning',
    icon: 'clock',
    meaning: 'The state is valid but requires awareness or a next action.',
    usage: 'Explain what needs attention; warning is not a generic accent colour.',
  },
  {
    id: 'failed',
    label: 'Failed',
    tone: 'danger',
    icon: 'alert-circle',
    meaning: 'A required operation did not complete.',
    usage: 'Keep failure distinct from empty and provide bounded recovery when safe.',
  },
  {
    id: 'information',
    label: 'Information',
    tone: 'info',
    icon: 'info',
    meaning: 'Supporting context that is neither success nor warning.',
    usage: 'Prefer concise copy; do not turn routine instructions into permanent banners.',
  },
  {
    id: 'in-progress',
    label: 'In progress',
    tone: 'neutral',
    icon: 'loader',
    meaning: 'Work is currently running.',
    usage: 'Use an explicit status label and preserve reduced-motion behaviour.',
  },
  {
    id: 'unavailable',
    label: 'Unavailable',
    tone: 'warning',
    icon: 'lock',
    meaning: 'The current identity cannot use the surface or action.',
    usage: 'Do not imply that retrying will fix an authorization boundary.',
  },
] as const

export const REFERENCE_ROUTES = {
  teacher: [
    { label: 'Classrooms', href: '/classrooms' },
    { label: 'Teacher dashboard', href: '/teacher/dashboard' },
    { label: 'Snapshot gallery', href: '/snapshots-gallery' },
  ],
  student: [
    { label: 'Classrooms', href: '/classrooms' },
    { label: 'Student history', href: '/student/history' },
  ],
} as const
