'use client'

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Code2, Copy, Eye, GripVertical, ListPlus, Plus, Settings, Trash2, X } from 'lucide-react'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { MarkdownContentEditor } from '@/components/editor'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { TeacherWorkSurfaceIconMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { markdownToSurvey, surveyToMarkdown, type SurveyMarkdownQuestion } from '@/lib/survey-markdown'
import { DEFAULT_SURVEY_TEXT_MAX_CHARS, MAX_SURVEY_OPTIONS, normalizeSurveyQuestionInput } from '@/lib/surveys'
import { Button, Card, FormField, Input, SaveStatus, Tooltip } from '@/ui'

type Question = SurveyMarkdownQuestion & { id: string }

function initialQuestions(): Question[] {
  return [
    { id: 'survey-prototype-1', question_type: 'multiple_choice', question_text: 'Which activity helped you understand the wetland ecosystem best?', options: ['The field observations', 'The group discussion', 'The species research', 'The data analysis', ''], response_max_chars: DEFAULT_SURVEY_TEXT_MAX_CHARS },
    { id: 'survey-prototype-2', question_type: 'short_text', question_text: 'What is one thing you would change about the field study?', options: [], response_max_chars: DEFAULT_SURVEY_TEXT_MAX_CHARS },
    { id: 'survey-prototype-3', question_type: 'multiple_choice', question_text: 'How confident do you feel explaining relationships in an ecosystem?', options: ['Very confident', 'Somewhat confident', 'Still learning', ''], response_max_chars: DEFAULT_SURVEY_TEXT_MAX_CHARS },
  ]
}

/** Experimental authoring composition. Fixed fixtures; all actions stay in local state. */
export function SurveyEditSplitPattern() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('Wetland field study feedback')
  const [questions, setQuestions] = useState<Question[]>(initialQuestions)
  const [selected, setSelected] = useState(0)
  const [numberDraft, setNumberDraft] = useState('1')
  const [showResults, setShowResults] = useState(false)
  const [dynamicResponses, setDynamicResponses] = useState(false)
  const [changed, setChanged] = useState(false)
  const [published, setPublished] = useState(false)
  const [code, setCode] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [markdownError, setMarkdownError] = useState('')
  const [preview, setPreview] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const nextId = useRef(4)
  const handles = useRef<Array<HTMLButtonElement | null>>([])
  const previewButton = useRef<HTMLButtonElement | null>(null)
  const current = questions[selected]
  const isMc = current.question_type === 'multiple_choice'
  const titleError = title.trim() ? undefined : 'Add a title before publishing.'
  const invalidIndex = questions.findIndex((question) => !normalizeSurveyQuestionInput(question).valid)
  const valid = !titleError && invalidIndex < 0

  function change() {
    setChanged(true)
    setPublished(false)
  }

  function reset() {
    setTitle('Wetland field study feedback')
    setQuestions(initialQuestions())
    select(0)
    setShowResults(false)
    setDynamicResponses(false)
    setChanged(false)
    setPublished(false)
    setCode(false)
    setMarkdownError('')
    setPreview(false)
    setDragging(null)
    nextId.current = 4
    setOpen(true)
  }

  function select(index: number) {
    const next = Math.max(0, Math.min(questions.length - 1, index))
    setSelected(next)
    setNumberDraft(String(next + 1))
  }

  function applyNumber() {
    const requested = Number.parseInt(numberDraft, 10)
    select(Number.isFinite(requested) ? requested - 1 : selected)
  }

  function updateQuestion(patch: Partial<Question>) {
    setQuestions((items) => items.map((item, index) => index === selected ? { ...item, ...patch } : item))
    change()
  }

  function addQuestion(type: 'multiple_choice' | 'short_text') {
    const id = `survey-prototype-${nextId.current++}`
    setQuestions((items) => [...items, { id, question_type: type, question_text: '', options: type === 'multiple_choice' ? ['', ''] : [], response_max_chars: DEFAULT_SURVEY_TEXT_MAX_CHARS }])
    setSelected(questions.length)
    setNumberDraft(String(questions.length + 1))
    change()
  }

  function duplicate() {
    const copy = { ...current, id: `survey-prototype-${nextId.current++}`, options: [...current.options] }
    setQuestions((items) => [...items.slice(0, selected + 1), copy, ...items.slice(selected + 1)])
    setSelected(selected + 1)
    setNumberDraft(String(selected + 2))
    change()
  }

  function removeQuestion() {
    if (questions.length <= 1) return
    setQuestions((items) => items.filter((_, index) => index !== selected))
    const next = Math.min(selected, questions.length - 2)
    setSelected(next)
    setNumberDraft(String(next + 1))
    change()
  }

  function updateOption(index: number, value: string) {
    const options = current.options.map((option, i) => i === index ? value : option)
    if (index === options.length - 1 && value.trim() && options.length < MAX_SURVEY_OPTIONS) options.push('')
    updateQuestion({ options })
  }

  function moveOption(from: number, to: number) {
    if (from === to || !current.options[from]?.trim() || !current.options[to]?.trim()) return
    const options = [...current.options]
    const [option] = options.splice(from, 1)
    options.splice(to, 0, option)
    updateQuestion({ options })
  }

  function toggleCode() {
    if (!code) {
      setMarkdown(surveyToMarkdown({ survey: { title, show_results: showResults, dynamic_responses: dynamicResponses }, questions: questions.map((question) => ({ ...question, options: question.options.filter((option) => option.trim()) })) }))
      setMarkdownError('')
    }
    setCode(!code)
  }

  function applyMarkdown() {
    const parsed = markdownToSurvey(markdown)
    if (!parsed.content) {
      setMarkdownError(parsed.errors.join('\n'))
      return
    }
    // This prototype explores MC and open responses only.
    if (parsed.content.questions.some((question) => question.question_type === 'link')) {
      setMarkdownError('This prototype supports multiple-choice and open-response questions.')
      return
    }
    setTitle(parsed.content.title)
    setShowResults(parsed.content.show_results)
    setDynamicResponses(parsed.content.dynamic_responses)
    setQuestions(parsed.content.questions.map((question) => ({ ...question, id: `survey-prototype-${nextId.current++}`, options: question.question_type === 'multiple_choice' && question.options.length < MAX_SURVEY_OPTIONS ? [...question.options, ''] : question.options })))
    setSelected(0)
    setNumberDraft('1')
    setCode(false)
    setMarkdownError('')
    change()
  }

  function closePreview() {
    setPreview(false)
    window.requestAnimationFrame(() => previewButton.current?.focus())
  }

  return (
    <section id="survey-edit-split">
      <Card tone="accent" padding="md">
        <h3 className="font-semibold">Survey edit · split-pane prototype</h3>
        <p className="mt-2 text-sm text-text-muted">Experimental. Based on the Test modal: survey details on the left, one question at a time on the right. Explore multiple-choice and open responses. Changes and publishing stay in this prototype.</p>
        <Button className="mt-3" variant="surface" onClick={reset}>Open survey edit prototype</Button>
      </Card>
      <CreationModalShell isOpen={open && !preview} onClose={() => setOpen(false)} title="Edit Survey" titleId="pattern-survey-edit-title" closeLabel="Close survey edit prototype" showCloseButton={false} maxWidth="!max-w-6xl" panelClassName="!p-0" tall contentClassName="!overflow-hidden !p-0">
        <div className="grid min-h-0 w-full grid-cols-1 overflow-y-auto lg:h-full lg:grid-cols-3 lg:overflow-hidden">
          <div data-testid="survey-editor-details-pane" className="flex min-h-0 flex-col gap-3 bg-surface-2 p-3 sm:p-4 lg:overflow-y-auto">
            <FormField label="Title" required error={titleError} labelAccessory={(
              <div className="flex items-center gap-1">
                <SaveStatus status={changed ? 'unsaved' : 'saved'} className={changed ? undefined : 'text-text-muted'} />
                <TeacherWorkSurfaceIconMenuButton icon={<Settings className="h-4 w-4" aria-hidden="true" />} ariaLabel="Settings" tooltip="Settings" variant="ghost" menuAriaLabel="Survey settings" menuPlacement="down" menuAlign="end" items={[
                  { id: 'results', label: 'Show class results to students', checked: showResults, checkedRole: 'menuitemcheckbox', onSelect: () => { setShowResults(!showResults); change() } },
                  { id: 'dynamic', label: 'Allow students to update responses', checked: dynamicResponses, checkedRole: 'menuitemcheckbox', onSelect: () => { setDynamicResponses(!dynamicResponses); change() } },
                ]} />
                <Tooltip content="Close"><Button variant="ghost" size="sm" aria-label="Close survey edit prototype" onClick={() => setOpen(false)} className="h-11 w-11 p-0"><X className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
              </div>
            )}>
              <Input value={title} placeholder="Title" maxLength={200} onChange={(event) => { setTitle(event.target.value); change() }} />
            </FormField>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Questions</p><p className="text-xs text-text-muted">{questions.length} total</p></div>
            </div>
            <Button variant={code ? 'subtle' : 'surface'} size="sm" fullWidth aria-pressed={code} onClick={toggleCode} className="justify-start"><Code2 className="h-4 w-4" aria-hidden="true" />Markdown</Button>
            <div className="mt-1 shrink-0 lg:mt-auto">
              <div className="grid grid-cols-2 gap-2">
                <Button ref={previewButton} variant="secondary" size="sm" fullWidth disabled={code} onClick={() => setPreview(true)}><Eye className="h-4 w-4" aria-hidden="true" />Preview</Button>
                <Button fullWidth size="sm" disabled={!valid || code} onClick={() => { setChanged(false); setPublished(true) }}>Publish</Button>
              </div>
              {invalidIndex >= 0 ? <p className="mt-2 text-xs text-danger" role="alert">Check question {invalidIndex + 1}: add a prompt and at least two options for multiple choice.</p> : null}
              {published ? <p className="mt-2 text-xs text-success" role="status">Published in this prototype only.</p> : null}
            </div>
          </div>
          <div data-testid="survey-editor-content-pane" className="flex min-h-96 flex-col gap-3 p-3 sm:p-4 lg:col-span-2 lg:min-h-0 lg:overflow-hidden">
            {code ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Survey Markdown</p><Button size="sm" onClick={applyMarkdown}>Apply Markdown</Button></div>
                <p className="text-xs text-text-muted">Edit the complete survey structure, then apply to return to questions.</p>
                {markdownError ? <p role="alert" className="whitespace-pre-wrap text-sm text-danger">{markdownError}</p> : null}
                <textarea aria-label="Survey markdown editor" value={markdown} spellCheck={false} onChange={(event) => setMarkdown(event.target.value)} className="min-h-96 flex-1 resize-none rounded-md border border-border bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            ) : (
              <>
                <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <p className="col-start-1 row-start-2 text-xs text-text-muted lg:row-start-1">{isMc ? 'Multiple choice' : 'Open response'}</p>
                  <div role="group" aria-label="Question navigation" className="col-span-2 col-start-1 row-start-1 flex items-center justify-self-center gap-1 lg:col-span-1 lg:col-start-2">
                    <Tooltip content="Previous question"><Button variant="ghost" size="sm" aria-label="Previous question" disabled={selected === 0} onClick={() => select(selected - 1)} className="h-11 w-11 p-0 text-text-muted"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
                    <Input type="number" min="1" max={questions.length} value={numberDraft} aria-label="Question number" onChange={(event) => setNumberDraft(event.target.value)} onBlur={applyNumber} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyNumber() } }} className="w-14 px-2 text-center" />
                    <span className="whitespace-nowrap text-xs text-text-muted">/ {questions.length}</span>
                    <Tooltip content="Next question"><Button variant="ghost" size="sm" aria-label="Next question" disabled={selected === questions.length - 1} onClick={() => select(selected + 1)} className="h-11 w-11 p-0 text-text-muted"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
                  </div>
                  <div className="col-start-2 row-start-2 justify-self-end lg:col-start-3 lg:row-start-1">
                    <TeacherWorkSurfaceIconMenuButton icon={<ListPlus className="h-5 w-5" aria-hidden="true" />} ariaLabel="Question actions" tooltip="Question actions" menuAriaLabel="Question actions" variant="primary" menuPlacement="down" menuAlign="end" className="h-11 w-14 shadow-sm" items={[
                      { id: 'mc', label: 'Add multiple-choice question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect: () => addQuestion('multiple_choice') },
                      { id: 'open', label: 'Add open-response question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect: () => addQuestion('short_text') },
                      { id: 'duplicate', label: 'Duplicate question', icon: <Copy className="h-4 w-4" aria-hidden="true" />, dividerBefore: true, onSelect: duplicate },
                      { id: 'delete', label: 'Delete question', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, destructive: true, disabled: questions.length <= 1, onSelect: removeQuestion },
                    ]} />
                  </div>
                </div>
                <MarkdownContentEditor key={current.id} markdown={current.question_text} onMarkdownChange={(question_text) => updateQuestion({ question_text })} aria-label={`Question ${selected + 1} prompt`} placeholder={`Question ${selected + 1}`} toolbarPreset="compact" className="shrink-0 overflow-hidden rounded-md border border-border bg-surface [&_.ProseMirror]:!min-h-32" />
                {isMc ? (
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md bg-surface-2 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Answer options</p>
                    {current.options.map((option, index) => {
                      const letter = index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
                      const blank = !option.trim()
                      return (
                        <div key={index} draggable={!blank} onDragStart={() => setDragging(index)} onDragEnd={() => setDragging(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragging !== null) moveOption(dragging, index); setDragging(null) }} className="flex items-center gap-2">
                          <Tooltip content="Reorder option"><Button ref={(element) => { handles.current[index] = element }} variant="ghost" size="sm" aria-label={`Reorder option ${letter}; use Up and Down arrow keys`} aria-keyshortcuts="ArrowUp ArrowDown" disabled={blank} onKeyDown={(event) => {
                            const next = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : index
                            if (next === index || !current.options[next]?.trim()) return
                            event.preventDefault()
                            moveOption(index, next)
                            window.requestAnimationFrame(() => handles.current[next]?.focus())
                          }} className="h-11 w-11 shrink-0 cursor-grab p-0 text-text-muted"><GripVertical className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-sm text-text-muted" aria-hidden="true">{letter}</span>
                          <Input value={option} aria-label={`Question ${selected + 1} option ${letter}`} placeholder={`Option ${letter}`} onChange={(event) => updateOption(index, event.target.value)} />
                          {blank ? <span className="h-11 w-11 shrink-0" aria-hidden="true" /> : <Tooltip content="Delete option"><Button variant="ghost" size="sm" aria-label={`Delete option ${letter}`} disabled={current.options.filter((item) => item.trim()).length <= 2} onClick={() => updateQuestion({ options: current.options.filter((_, i) => i !== index) })} className="h-11 w-11 shrink-0 p-0 text-text-muted"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 rounded-md bg-surface-2 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Open response</p>
                    <p className="mt-2 text-sm text-text-muted">Students answer in their own words.</p>
                    <FormField label="Response character limit" className="mt-3"><Input type="number" min="1" max="5000" value={current.response_max_chars} onChange={(event) => updateQuestion({ response_max_chars: Math.max(1, Math.min(5000, Number(event.target.value) || 1)) })} /></FormField>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </CreationModalShell>
      <CreationModalShell isOpen={open && preview} onClose={closePreview} title="Survey preview" titleId="pattern-survey-preview-title" closeLabel="Back to survey editor" showTitle maxWidth="!max-w-3xl" tall>
        <div className="space-y-5">
          <div><h3 className="text-lg font-semibold">{title || 'Untitled Survey'}</h3><p className="mt-1 text-sm text-text-muted">Student preview · responses are not submitted.</p></div>
          {questions.map((question, index) => (
            <div key={question.id} className="space-y-3 rounded-md border border-border p-4">
              <p className="text-xs text-text-muted">Question {index + 1}</p>
              <QuestionMarkdown content={question.question_text} />
              {question.question_type === 'multiple_choice' ? <div role="group" aria-label={`Question ${index + 1} response`} className="space-y-2">{question.options.filter((option) => option.trim()).map((option, optionIndex) => <label key={optionIndex} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2"><Input type="radio" name={`survey-preview-${question.id}`} aria-label={option} className="h-4 w-4 shrink-0" />{option}</label>)}</div> : <textarea aria-label={`Question ${index + 1} response`} placeholder="Write your response…" maxLength={question.response_max_chars} rows={4} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary" />}
            </div>
          ))}
          <Button variant="secondary" onClick={closePreview}>Back to editor</Button>
        </div>
      </CreationModalShell>
    </section>
  )
}
