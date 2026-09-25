'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Code2, Copy, Eye, FileText, GripVertical, Link2, ListPlus, Plus, Settings, Text, Trash2, X } from 'lucide-react'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { TeacherTestPreviewPage } from '@/components/TeacherTestPreviewPage'
import type { ExamDocumentItem } from '@/components/ExamDocumentWorkspace'
import { MarkdownContentEditor } from '@/components/editor'
import { TeacherWorkSurfaceIconMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { markdownToTest } from '@/lib/test-markdown'
import { MAX_TEST_DOCUMENT_TEXT_LENGTH } from '@/lib/test-documents'
import type { TestAssessmentQuestion, TestDocument } from '@/types'
import {
  Button,
  Card,
  DialogPanel,
  FormField,
  Input,
  SaveStatus,
  SplitButton,
  Tooltip,
} from '@/ui'

const SAMPLE_QUESTIONS = [
  'Which observation best supports the idea that the wetland is a healthy ecosystem?',
  'Explain how two organisms in the wetland depend on one another.',
  'Write a short function that groups the observations by species.',
  'Which measurement would best show a change in water quality?',
  'What pattern do you notice in the species observations?',
  'Explain one limitation of the field study.',
  'Which conclusion is best supported by the collected data?',
  'Describe one follow-up observation that would strengthen the study.',
]
const SAMPLE_QUESTION_TYPES = ['mc', 'open', 'open', 'mc', 'mc', 'open', 'mc', 'open'] as const
const SAMPLE_OPTIONS = [
  'Several native species use the same habitat.',
  'The water is deeper near the boardwalk.',
  'Visitors can hear traffic from the road.',
  'The trail is busiest in the afternoon.',
]
const initialQuestionOptions = () => SAMPLE_QUESTION_TYPES.map((type) => type === 'mc' ? [...SAMPLE_OPTIONS, ''] : [])
const SAMPLE_SOLUTIONS = [
  '',
  'For example, insects feed fish while aquatic plants provide shelter for insects.',
  'function groupBySpecies(observations) {\n  return Object.groupBy(observations, ({ species }) => species)\n}',
  '',
  '',
  'The observations were collected during one short visit, so they may not represent other seasons.',
  '',
  'Repeat the species count at the same locations in another season and compare the results.',
]
const MAX_MC_OPTIONS = 6
const PROTOTYPE_TEST_ID = '00000000-0000-4000-8000-000000000999'
const PROTOTYPE_DATE = '2026-09-25T00:00:00.000Z'

type ReferenceType = 'link' | 'pdf' | 'text'

interface ReferenceDraft {
  id: string
  type: ReferenceType
  label: string
  content?: string
}

interface TextReferenceEditorDraft {
  id: string | null
  title: string
  content: string
}

const SAMPLE_REFERENCES: ReferenceDraft[] = [
  { id: 'wetland-reference', type: 'pdf', label: 'Wetland reference sheet.pdf' },
]

function ReferenceIcon({ type }: { type: ReferenceType }) {
  if (type === 'link') return <Link2 className="h-4 w-4" aria-hidden="true" />
  if (type === 'text') return <Text className="h-4 w-4" aria-hidden="true" />
  return <FileText className="h-4 w-4" aria-hidden="true" />
}

function prototypeUuid(scope: 'question' | 'document', index: number) {
  const value = (scope === 'question' ? index + 1 : index + 101).toString().padStart(12, '0')
  return `00000000-0000-4000-8000-${value}`
}

export function TestEditSplitPattern() {
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [title, setTitle] = useState('Wetland field study')
  const [questions, setQuestions] = useState([...SAMPLE_QUESTIONS])
  const [questionTypes, setQuestionTypes] = useState<Array<'mc' | 'open'>>([...SAMPLE_QUESTION_TYPES])
  const [selectedQuestion, setSelectedQuestion] = useState(1)
  const [questionNumberDraft, setQuestionNumberDraft] = useState('1')
  const [points, setPoints] = useState(['1', '5', '3', '1', '1', '5', '1', '5'])
  const [answerKeys, setAnswerKeys] = useState([
    '',
    'The response identifies a valid relationship and explains how each organism benefits or survives.',
    'A function that returns observations grouped under each species name.',
    '',
    '',
    'The response names a relevant limitation and explains its effect on the evidence.',
    '',
    'The response proposes a relevant observation and explains what it would clarify.',
  ])
  const [sampleSolutions, setSampleSolutions] = useState([...SAMPLE_SOLUTIONS])
  const [responseFormats, setResponseFormats] = useState<Array<'written' | 'code'>>([
    'written', 'written', 'code', 'written', 'written', 'written', 'written', 'written',
  ])
  const [optionsByQuestion, setOptionsByQuestion] = useState(initialQuestionOptions)
  const [references, setReferences] = useState<ReferenceDraft[]>(SAMPLE_REFERENCES)
  const [textReferenceEditor, setTextReferenceEditor] = useState<TextReferenceEditorDraft | null>(null)
  const [textReferenceError, setTextReferenceError] = useState('')
  const [correctOptions, setCorrectOptions] = useState(SAMPLE_QUESTION_TYPES.map(() => 0))
  const [draggingOption, setDraggingOption] = useState<number | null>(null)
  const [results, setResults] = useState('after-return')
  const [changed, setChanged] = useState(false)
  const [authoringView, setAuthoringView] = useState<'questions' | 'code'>('questions')
  const [markdownSource, setMarkdownSource] = useState('')
  const [appliedMarkdownSource, setAppliedMarkdownSource] = useState('')
  const [markdownError, setMarkdownError] = useState<string | null>(null)
  const nextReferenceIdRef = useRef(1)
  const previewButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setQuestionNumberDraft(String(selectedQuestion))
  }, [selectedQuestion])

  function openPrototype() {
    setTitle('Wetland field study')
    setQuestions([...SAMPLE_QUESTIONS])
    setQuestionTypes([...SAMPLE_QUESTION_TYPES])
    setSelectedQuestion(1)
    setQuestionNumberDraft('1')
    setPoints(['1', '5', '3', '1', '1', '5', '1', '5'])
    setAnswerKeys([
      '',
      'The response identifies a valid relationship and explains how each organism benefits or survives.',
      'A function that returns observations grouped under each species name.',
      '',
      '',
      'The response names a relevant limitation and explains its effect on the evidence.',
      '',
      'The response proposes a relevant observation and explains what it would clarify.',
    ])
    setSampleSolutions([...SAMPLE_SOLUTIONS])
    setResponseFormats([
      'written', 'written', 'code', 'written', 'written', 'written', 'written', 'written',
    ])
    setOptionsByQuestion(initialQuestionOptions())
    setReferences(SAMPLE_REFERENCES)
    setTextReferenceEditor(null)
    setTextReferenceError('')
    setCorrectOptions(SAMPLE_QUESTION_TYPES.map(() => 0))
    setDraggingOption(null)
    setResults('after-return')
    setChanged(false)
    setAuthoringView('questions')
    setMarkdownSource('')
    setAppliedMarkdownSource('')
    setMarkdownError(null)
    setPreviewOpen(false)
    nextReferenceIdRef.current = 1
    setOpen(true)
  }

  function updateOption(index: number, value: string) {
    setOptionsByQuestion((current) => current.map((questionOptions, questionOptionIndex) => {
      if (questionOptionIndex !== questionIndex) return questionOptions
      const next = questionOptions.map((option, optionIndex) => optionIndex === index ? value : option)
      if (index === questionOptions.length - 1 && value.trim() && questionOptions.length < MAX_MC_OPTIONS) next.push('')
      return next
    }))
    setChanged(true)
  }

  function addQuestion(type: 'mc' | 'open') {
    const nextQuestionNumber = questions.length + 1
    setQuestions((current) => [
      ...current,
      type === 'mc' ? `Multiple choice question ${nextQuestionNumber}` : `Open response question ${nextQuestionNumber}`,
    ])
    setQuestionTypes((current) => [...current, type])
    setPoints((current) => [...current, type === 'mc' ? '1' : '5'])
    setAnswerKeys((current) => [...current, ''])
    setSampleSolutions((current) => [...current, ''])
    setResponseFormats((current) => [...current, 'written'])
    setOptionsByQuestion((current) => [...current, type === 'mc' ? ['', ''] : []])
    setCorrectOptions((current) => [...current, 0])
    setSelectedQuestion(nextQuestionNumber)
    setChanged(true)
  }

  function deleteCurrentQuestion() {
    if (questions.length <= 1) return
    setQuestions((current) => current.filter((_, index) => index !== questionIndex))
    setQuestionTypes((current) => current.filter((_, index) => index !== questionIndex))
    setPoints((current) => current.filter((_, index) => index !== questionIndex))
    setAnswerKeys((current) => current.filter((_, index) => index !== questionIndex))
    setSampleSolutions((current) => current.filter((_, index) => index !== questionIndex))
    setResponseFormats((current) => current.filter((_, index) => index !== questionIndex))
    setOptionsByQuestion((current) => current.filter((_, index) => index !== questionIndex))
    setCorrectOptions((current) => current.filter((_, index) => index !== questionIndex))
    setSelectedQuestion((current) => Math.min(current, questions.length - 1))
    setChanged(true)
  }

  function duplicateCurrentQuestion() {
    const insertAt = questionIndex + 1
    setQuestions((current) => [...current.slice(0, insertAt), `${current[questionIndex]} (copy)`, ...current.slice(insertAt)])
    setQuestionTypes((current) => [...current.slice(0, insertAt), current[questionIndex], ...current.slice(insertAt)])
    setPoints((current) => [...current.slice(0, insertAt), current[questionIndex], ...current.slice(insertAt)])
    setAnswerKeys((current) => [...current.slice(0, insertAt), current[questionIndex], ...current.slice(insertAt)])
    setSampleSolutions((current) => [...current.slice(0, insertAt), current[questionIndex], ...current.slice(insertAt)])
    setResponseFormats((current) => [...current.slice(0, insertAt), current[questionIndex], ...current.slice(insertAt)])
    setOptionsByQuestion((current) => [...current.slice(0, insertAt), [...current[questionIndex]], ...current.slice(insertAt)])
    setCorrectOptions((current) => [...current.slice(0, insertAt), current[questionIndex], ...current.slice(insertAt)])
    setSelectedQuestion(insertAt + 1)
    setChanged(true)
  }

  function removeOption(index: number) {
    if (options.filter((option) => option.trim()).length <= 2 || !options[index]?.trim()) return
    setOptionsByQuestion((current) => current.map((questionOptions, questionOptionIndex) => (
      questionOptionIndex === questionIndex ? questionOptions.filter((_, optionIndex) => optionIndex !== index) : questionOptions
    )))
    setCorrectOptions((current) => current.map((selected, selectedIndex) => (
      selectedIndex !== questionIndex ? selected : selected === index ? 0 : selected > index ? selected - 1 : selected
    )))
    setChanged(true)
  }

  function moveOption(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    setOptionsByQuestion((current) => current.map((questionOptions, questionOptionIndex) => {
      if (questionOptionIndex !== questionIndex) return questionOptions
      const next = [...questionOptions]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    }))
    setCorrectOptions((current) => current.map((selected, selectedIndex) => {
      if (selectedIndex !== questionIndex) return selected
      if (selected === fromIndex) return toIndex
      if (fromIndex < selected && toIndex >= selected) return selected - 1
      if (fromIndex > selected && toIndex <= selected) return selected + 1
      return selected
    }))
    setChanged(true)
  }

  function addReference(type: ReferenceType) {
    if (type === 'text') {
      setTextReferenceEditor({ id: null, title: '', content: '' })
      setTextReferenceError('')
      return
    }
    const number = references.length + 1
    const defaultLabel = type === 'link'
      ? `Link reference ${number}`
      : `PDF reference ${number}`
    const id = `reference-${nextReferenceIdRef.current}`
    nextReferenceIdRef.current += 1
    setReferences((current) => [...current, { id, type, label: defaultLabel }])
    setChanged(true)
  }

  function editTextReference(reference: ReferenceDraft) {
    setTextReferenceEditor({ id: reference.id, title: reference.label, content: reference.content || '' })
    setTextReferenceError('')
  }

  function saveTextReference() {
    if (!textReferenceEditor) return
    const title = textReferenceEditor.title.trim()
    const content = textReferenceEditor.content.trim()
    if (!title || !content) {
      setTextReferenceError(!title ? 'Document title is required' : 'Document text is required')
      return
    }
    if (textReferenceEditor.id) {
      setReferences((current) => current.map((reference) => reference.id === textReferenceEditor.id
        ? { ...reference, label: title.slice(0, 120), content: textReferenceEditor.content.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH) }
        : reference))
    } else {
      const id = `reference-${nextReferenceIdRef.current}`
      nextReferenceIdRef.current += 1
      setReferences((current) => [...current, {
        id,
        type: 'text',
        label: title.slice(0, 120),
        content: textReferenceEditor.content.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH),
      }])
    }
    setTextReferenceEditor(null)
    setTextReferenceError('')
    setChanged(true)
  }

  function moveReference(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    setReferences((current) => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    setChanged(true)
  }

  function selectQuestion(questionNumber: number) {
    const nextQuestion = Math.min(questions.length, Math.max(1, questionNumber))
    setSelectedQuestion(nextQuestion)
    setQuestionNumberDraft(String(nextQuestion))
  }

  function applyQuestionNumberDraft() {
    const requestedQuestion = Number.parseInt(questionNumberDraft, 10)
    selectQuestion(Number.isFinite(requestedQuestion) ? requestedQuestion : selectedQuestion)
  }

  function openFullTestPreview() {
    const fullscreenElement = document.documentElement
    if (!document.fullscreenElement && typeof fullscreenElement.requestFullscreen === 'function') {
      void fullscreenElement.requestFullscreen().catch(() => {
        // The shared preview shows its maximize prompt when fullscreen is unavailable.
      })
    }
    setPreviewOpen(true)
  }

  function closeFullTestPreview() {
    setPreviewOpen(false)
    window.requestAnimationFrame(() => previewButtonRef.current?.focus())
  }

  function buildMarkdownSource() {
    const lines = [`# Test`, `Title: ${title}`, `Show Results: ${results === 'after-return' ? 'true' : 'false'}`, '', '## Questions']
    questions.forEach((question, index) => {
      const openResponse = questionTypes[index] === 'open'
      lines.push('', `### Question ${index + 1}`, `ID: ${prototypeUuid('question', index)}`, `Type: ${openResponse ? 'open_response' : 'multiple_choice'}`, `Points: ${points[index]}`, 'Prompt:', question)
      if (openResponse) {
        lines.push(`Code: ${responseFormats[index] === 'code' ? 'true' : 'false'}`, 'Max Chars: 5000', 'Answer Key:', answerKeys[index] || '', 'Sample Solution:', sampleSolutions[index] || '')
      } else {
        lines.push('Options:', ...(optionsByQuestion[index] ?? []).filter((option) => option.trim()).map((option) => `- ${option}`), `Correct Option: ${(correctOptions[index] ?? 0) + 1}`)
      }
    })
    lines.push('', '## Documents')
    references.forEach((reference, index) => {
      lines.push('', `### Document ${index + 1}`, `ID: ${prototypeUuid('document', index)}`, `Source: ${reference.type === 'pdf' ? 'upload' : reference.type}`, `Title: ${reference.label}`)
      if (reference.type === 'link') lines.push(`URL: https://example.com/reference-${index + 1}`)
      if (reference.type === 'pdf') lines.push('Managed Upload: private')
      if (reference.type === 'text') lines.push('Content:', reference.content || '')
    })
    if (references.length === 0) lines.push('_None_')
    return lines.join('\n')
  }

  function applyMarkdown() {
    const existingDocuments: TestDocument[] = references.map((reference, index) => {
      const documentId = prototypeUuid('document', index)
      if (reference.type === 'pdf') {
        return {
          id: documentId,
          title: reference.label,
          source: 'upload',
          storage_bucket: 'test-documents',
          storage_path: `pattern/${documentId}.pdf`,
        }
      }
      if (reference.type === 'text') {
        return { id: documentId, title: reference.label, source: 'text', content: reference.content || '' }
      }
      return { id: documentId, title: reference.label, source: 'link', url: `https://example.com/reference-${index + 1}` }
    })
    const parsed = markdownToTest(markdownSource, { existingDocuments })
    if (!parsed.draftContent || parsed.errors.length > 0) {
      setMarkdownError(parsed.errors.join('\n') || 'Could not apply Markdown.')
      return
    }
    const draft = parsed.draftContent
    setTitle(draft.title)
    setResults(draft.show_results ? 'after-return' : 'hidden')
    setQuestions(draft.questions.map((question) => question.question_text))
    setQuestionTypes(draft.questions.map((question) => question.question_type === 'open_response' ? 'open' : 'mc'))
    setPoints(draft.questions.map((question) => String(question.points)))
    setAnswerKeys(draft.questions.map((question) => question.answer_key || ''))
    setSampleSolutions(draft.questions.map((question) => question.sample_solution || ''))
    setResponseFormats(draft.questions.map((question) => question.response_monospace ? 'code' : 'written'))
    setOptionsByQuestion(draft.questions.map((question) => question.question_type === 'multiple_choice'
      ? [...question.options, ...(question.options.length < MAX_MC_OPTIONS ? [''] : [])]
      : []))
    setCorrectOptions(draft.questions.map((question) => question.correct_option ?? 0))
    setReferences(parsed.documents.map((document) => ({
      id: document.id,
      type: document.source === 'upload' ? 'pdf' : document.source,
      label: document.title,
      ...(document.source === 'text' ? { content: document.content || '' } : {}),
    })))
    setSelectedQuestion((current) => Math.min(current, draft.questions.length))
    setAppliedMarkdownSource(markdownSource)
    setMarkdownError(null)
    setChanged(false)
  }

  function toggleAuthoringView() {
    if (authoringView === 'questions') {
      const source = buildMarkdownSource()
      setMarkdownSource(source)
      setAppliedMarkdownSource(source)
      setMarkdownError(null)
      setAuthoringView('code')
      return
    }
    setAuthoringView('questions')
  }

  const questionIndex = selectedQuestion - 1
  const isMultipleChoice = questionTypes[questionIndex] === 'mc'
  const responseFormat = responseFormats[questionIndex] === 'code' ? 'Code response' : 'Written response'
  const options = optionsByQuestion[questionIndex] ?? []
  const correctOption = correctOptions[questionIndex] ?? 0
  const totalPoints = useMemo(
    () => points.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0), 0),
    [points]
  )
  const filledOptions = options.filter((option) => option.trim())
  const titleError = title.trim() ? undefined : 'Add a title before publishing.'
  const questionError = questions[questionIndex]?.trim() ? undefined : 'Add a question prompt.'
  const pointsError = Number(points[questionIndex]) > 0 ? undefined : 'Points must be greater than 0.'
  const optionsError = isMultipleChoice && (filledOptions.length < 2 || filledOptions.length > MAX_MC_OPTIONS)
    ? `Multiple-choice questions need 2–${MAX_MC_OPTIONS} options.`
    : undefined
  const validationErrors = [titleError, questionError, pointsError, optionsError].filter(Boolean)
  const previewDraft = useMemo(() => ({
    title: title || 'Untitled Test',
    questions: questions.map((question, index): TestAssessmentQuestion => ({
      id: prototypeUuid('question', index),
      test_id: PROTOTYPE_TEST_ID,
      question_text: question,
      question_type: questionTypes[index] === 'open' ? 'open_response' : 'multiple_choice',
      options: questionTypes[index] === 'mc' ? (optionsByQuestion[index] ?? []).filter((option) => option.trim()) : [],
      position: index,
      points: Number(points[index]) || 0,
      response_max_chars: 5000,
      response_monospace: responseFormats[index] === 'code',
      answer_key: answerKeys[index],
      sample_solution: sampleSolutions[index],
      correct_option: questionTypes[index] === 'mc' ? correctOptions[index] ?? 0 : null,
      created_at: PROTOTYPE_DATE,
      updated_at: PROTOTYPE_DATE,
    })),
    documents: references.map((reference, index): ExamDocumentItem => ({
      id: prototypeUuid('document', index),
      title: reference.label,
      source: reference.type === 'pdf' ? 'upload' : reference.type,
      url: reference.type === 'link' ? `https://example.com/reference-${index + 1}` : undefined,
      content: reference.type === 'text' ? reference.content : undefined,
    })),
  }), [answerKeys, correctOptions, optionsByQuestion, points, questionTypes, questions, references, responseFormats, sampleSolutions, title])

  return (
    <section id="test-edit-split">
      <Card tone="accent" padding="md">
        <h3 className="font-semibold">Test edit · split-pane prototype</h3>
        <p className="mt-2 text-sm text-text-muted">
          Test details and publishing stay in the left pane. The question editor owns the wider right pane, with formatting controls at its top. The panes stack on mobile.
        </p>
        <Button className="mt-3" variant="surface" onClick={openPrototype}>Open test edit prototype</Button>
      </Card>

      <CreationModalShell
        isOpen={open && !previewOpen}
        onClose={() => setOpen(false)}
        title="Edit Test"
        titleId="pattern-test-edit-title"
        closeLabel="Close test edit prototype"
        showCloseButton={false}
        maxWidth="!max-w-6xl"
        panelClassName="!p-0"
        tall
        contentClassName="!overflow-hidden !p-0"
      >
        <div className="grid min-h-0 w-full grid-cols-1 overflow-y-auto lg:h-full lg:grid-cols-3 lg:overflow-hidden">
          <div
            data-testid="test-editor-details-pane"
            className="flex min-h-0 flex-col gap-3 bg-surface-2 p-3 sm:p-4 lg:overflow-y-auto"
          >
            <FormField
              label="Title"
              required
              error={titleError}
              labelAccessory={(
                <div className="flex items-center gap-1">
                  <SaveStatus status={changed ? 'unsaved' : 'saved'} className={changed ? undefined : 'text-text-muted'} />
                  <TeacherWorkSurfaceIconMenuButton
                    icon={<Settings className="h-4 w-4" aria-hidden="true" />}
                    ariaLabel="Settings"
                    tooltip="Settings"
                    variant="ghost"
                    menuAriaLabel="Test settings"
                    menuPlacement="down"
                    menuAlign="end"
                    items={[
                      {
                        id: 'after-return',
                        label: 'Show results after return',
                        checked: results === 'after-return',
                        checkedRole: 'menuitemradio',
                        onSelect: () => {
                          setResults('after-return')
                          setChanged(true)
                        },
                      },
                      {
                        id: 'hidden',
                        label: 'Keep results hidden',
                        checked: results === 'hidden',
                        checkedRole: 'menuitemradio',
                        onSelect: () => {
                          setResults('hidden')
                          setChanged(true)
                        },
                      },
                    ]}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Close test edit prototype"
                    onClick={() => setOpen(false)}
                    className="h-11 w-11 p-0"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            >
              <Input
                value={title}
                placeholder="Title"
                onChange={(event) => {
                  setTitle(event.target.value)
                  setChanged(true)
                }}
              />
            </FormField>

            <div role="group" aria-label="Reference Docs" className="rounded-lg border border-border-strong bg-surface">
              <div className="flex items-center justify-between gap-3 py-1 pl-3 pr-2">
                <p className="truncate text-sm font-medium leading-5 text-text-default">Reference Docs</p>
                <Tooltip content="Add reference" side="left">
                  <span className="inline-flex shrink-0">
                    <SplitButton
                      label={<Plus className="h-7 w-7" aria-hidden="true" />}
                      singleMenuTrigger
                      variant="ghost"
                      size="sm"
                      menuPlacement="down"
                      primaryButtonProps={{
                        'aria-label': 'Add reference',
                        className: 'h-11 w-11 p-0',
                      }}
                      options={[
                        { id: 'link', label: 'Link', icon: <ReferenceIcon type="link" />, onSelect: () => addReference('link') },
                        { id: 'pdf', label: 'PDF', icon: <ReferenceIcon type="pdf" />, onSelect: () => addReference('pdf') },
                        { id: 'text', label: 'Text', icon: <ReferenceIcon type="text" />, onSelect: () => addReference('text') },
                      ]}
                    />
                  </span>
                </Tooltip>
              </div>
              {references.length > 0 ? (
                <div className="divide-y divide-border border-t border-border">
                  {references.map((reference, index) => (
                    <div
                      key={reference.id}
                      draggable={references.length > 1}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault()
                        const fromIndex = Number(event.dataTransfer.getData('text/plain'))
                        if (Number.isInteger(fromIndex)) moveReference(fromIndex, index)
                      }}
                      className="grid grid-cols-[2.75rem_1.5rem_minmax(0,1fr)_2.75rem] items-center gap-1 px-1 py-1"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="flex h-11 w-11 cursor-grab items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text-default disabled:cursor-default disabled:opacity-50"
                        disabled={references.length < 2}
                        aria-label={`Drag to reorder ${reference.label}`}
                      >
                        <GripVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <span className="flex items-center justify-center text-text-muted" aria-label={`${reference.type} reference type`}>
                        <ReferenceIcon type={reference.type} />
                      </span>
                      {reference.type === 'text' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 min-w-0 justify-start px-2 text-left"
                          aria-label={`Edit ${reference.label}`}
                          onClick={() => editTextReference(reference)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{reference.label}</span>
                            <span className="block truncate text-xs text-text-muted">{reference.content}</span>
                          </span>
                        </Button>
                      ) : (
                        <Input
                          value={reference.label}
                          aria-label={`${reference.type} reference label`}
                          onChange={(event) => {
                            setReferences((current) => current.map((item) => (
                              item.id === reference.id ? { ...item, label: event.target.value } : item
                            )))
                            setChanged(true)
                          }}
                        />
                      )}
                      <Tooltip content="Remove">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-11 w-11 p-0 text-danger"
                          aria-label={`Remove ${reference.label}`}
                          onClick={() => {
                            setReferences((current) => current.filter((item) => item.id !== reference.id))
                            setChanged(true)
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-text-default">Questions</p>
                <p className="text-xs text-text-muted">{questions.length} total · {totalPoints} points</p>
              </div>
            </div>

            <Button
              type="button"
              variant={authoringView === 'code' ? 'subtle' : 'surface'}
              size="sm"
              fullWidth
              aria-pressed={authoringView === 'code'}
              onClick={toggleAuthoringView}
              className="justify-start"
            >
              <Code2 className="h-4 w-4" aria-hidden="true" />
              Markdown
            </Button>

            <div className="mt-1 shrink-0 lg:mt-auto">
              <div className="grid grid-cols-2 gap-2">
                <Button ref={previewButtonRef} type="button" variant="secondary" size="sm" fullWidth onClick={openFullTestPreview}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Preview
                </Button>
                <Button
                  type="button"
                  fullWidth
                  size="sm"
                  className="font-semibold"
                  disabled={validationErrors.length > 0}
                  onClick={() => setChanged(false)}
                >
                  Publish
                </Button>
              </div>
              {validationErrors.length > 0 ? (
                <p className="mt-2 text-xs text-danger" role="alert">Fix the highlighted fields before publishing.</p>
              ) : null}
            </div>
          </div>

          <div
            data-testid="test-editor-content-pane"
            className="flex min-h-96 flex-col gap-3 p-3 sm:p-4 lg:col-span-2 lg:min-h-0 lg:overflow-hidden"
          >
            {authoringView === 'code' ? (
              <p className="shrink-0 text-sm font-medium text-text-default">Test Markdown</p>
            ) : null}

            {authoringView === 'code' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-text-muted">Edit the complete test structure in Markdown.</p>
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={markdownSource === appliedMarkdownSource}
                      onClick={() => {
                        setMarkdownSource(appliedMarkdownSource)
                        setMarkdownError(null)
                        setChanged(false)
                      }}
                    >
                      Undo
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!markdownSource.includes('## Questions') || markdownSource === appliedMarkdownSource}
                      onClick={applyMarkdown}
                    >
                      Apply Markdown
                    </Button>
                  </div>
                </div>
                {!markdownSource.includes('## Questions') ? (
                  <p className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
                    Add a “## Questions” section before applying.
                  </p>
                ) : null}
                {markdownError ? (
                  <p className="whitespace-pre-wrap rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
                    {markdownError}
                  </p>
                ) : null}
                <textarea
                  aria-label="Test markdown editor"
                  value={markdownSource}
                  spellCheck={false}
                  onChange={(event) => {
                    setMarkdownSource(event.target.value)
                    setChanged(true)
                  }}
                  className="min-h-96 flex-1 resize-none rounded-md border border-border bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            ) : (
              <>
                <div data-testid="test-question-actionbar" className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <p className="col-start-1 row-start-2 text-xs text-text-muted lg:row-start-1">
                    {isMultipleChoice ? 'Multiple choice' : 'Open response'}
                  </p>
                  <div role="group" aria-label="Question navigation" className="col-span-2 col-start-1 row-start-1 flex items-center justify-self-center gap-1 lg:col-span-1 lg:col-start-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Previous question"
                      disabled={selectedQuestion === 1}
                      onClick={() => selectQuestion(selectedQuestion - 1)}
                      className="h-11 w-11 p-0 text-text-muted"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Input
                      type="number"
                      min="1"
                      max={questions.length}
                      step="1"
                      value={questionNumberDraft}
                      aria-label="Question number"
                      onChange={(event) => setQuestionNumberDraft(event.target.value)}
                      onBlur={applyQuestionNumberDraft}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          applyQuestionNumberDraft()
                        }
                      }}
                      className="w-14 px-2 text-center"
                    />
                    <span className="whitespace-nowrap text-xs text-text-muted">/ {questions.length}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Next question"
                      disabled={selectedQuestion === questions.length}
                      onClick={() => selectQuestion(selectedQuestion + 1)}
                      className="h-11 w-11 p-0 text-text-muted"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <div role="group" aria-label="Question actions" className="col-start-2 row-start-2 flex items-center justify-self-end gap-1 lg:col-start-3 lg:row-start-1">
                    <div className="relative w-24 shrink-0">
                      <label htmlFor="pattern-test-question-points" className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-text-muted">Points</label>
                      <Input
                        id="pattern-test-question-points"
                        type="number"
                        min="1"
                        step="1"
                        value={points[questionIndex]}
                        hasError={Boolean(pointsError)}
                        aria-invalid={pointsError ? 'true' : undefined}
                        onChange={(event) => {
                          setPoints((current) => current.map((value, index) => index === questionIndex ? event.target.value : value))
                          setChanged(true)
                        }}
                        className="w-full pl-12 pr-2 text-right"
                      />
                    </div>
                    <TeacherWorkSurfaceIconMenuButton
                      icon={<ListPlus className="h-5 w-5" aria-hidden="true" />}
                      ariaLabel="Question actions"
                      tooltip="Question actions"
                      menuAriaLabel="Question actions"
                      variant="primary"
                      menuPlacement="down"
                      menuAlign="end"
                      className="h-11 w-14 shadow-sm"
                      items={[
                        { id: 'mc', label: 'Add multiple-choice question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect: () => addQuestion('mc') },
                        { id: 'open', label: 'Add open-response question', icon: <Plus className="h-4 w-4" aria-hidden="true" />, onSelect: () => addQuestion('open') },
                        ...(!isMultipleChoice ? [{
                          id: 'code-response',
                          label: 'Code response',
                          icon: <Code2 className="h-4 w-4" aria-hidden="true" />,
                          dividerBefore: true,
                          checked: responseFormats[questionIndex] === 'code',
                          checkedRole: 'menuitemcheckbox' as const,
                          onSelect: () => {
                            setResponseFormats((current) => current.map((value, index) => (
                              index === questionIndex ? value === 'code' ? 'written' : 'code' : value
                            )))
                            setChanged(true)
                          },
                        }] : []),
                        { id: 'duplicate', label: 'Duplicate question', icon: <Copy className="h-4 w-4" aria-hidden="true" />, dividerBefore: isMultipleChoice, onSelect: duplicateCurrentQuestion },
                        { id: 'delete', label: 'Delete question', icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, disabled: questions.length <= 1, destructive: true, onSelect: deleteCurrentQuestion },
                      ]}
                    />
                  </div>
                </div>

            <MarkdownContentEditor
              markdown={questions[questionIndex]}
              onMarkdownChange={(value) => {
                setQuestions((current) => current.map((question, index) => index === questionIndex ? value : question))
                setChanged(true)
              }}
              aria-label={`Question ${selectedQuestion} prompt`}
              placeholder={`Question ${selectedQuestion}`}
              toolbarPreset="compact"
              className="shrink-0 overflow-hidden rounded-md border border-border bg-surface [&_.ProseMirror]:!min-h-32"
            />
            {questionError ? <p className="-mt-2 text-sm text-danger" role="alert">{questionError}</p> : null}
            {pointsError ? <p className="-mt-2 text-sm text-danger" role="alert">{pointsError}</p> : null}

            {isMultipleChoice ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md bg-surface-2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Answer options</p>
                {optionsError ? <p className="text-sm text-danger" role="alert">{optionsError}</p> : null}
                {options.map((option, index) => {
                  const letter = String.fromCharCode(65 + index)
                  const isBlankOption = !option.trim()
                  const filledOptionCount = options.filter((candidate) => candidate.trim()).length
                  return (
                    <div
                      key={letter}
                      draggable={!isBlankOption}
                      onDragStart={() => {
                        if (!isBlankOption) setDraggingOption(index)
                      }}
                      onDragEnd={() => setDraggingOption(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggingOption !== null && !isBlankOption) moveOption(draggingOption, index)
                        setDraggingOption(null)
                      }}
                      className="flex items-center gap-2"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={`Drag option ${letter} to reorder`}
                        disabled={isBlankOption}
                        className="shrink-0 cursor-grab px-2 text-text-muted active:cursor-grabbing"
                      >
                        <GripVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant={!isBlankOption && correctOption === index ? 'subtle' : 'surface'}
                        size="xs"
                        aria-pressed={!isBlankOption && correctOption === index}
                        aria-label={`Mark option ${letter} correct`}
                        disabled={isBlankOption}
                        onClick={() => {
                          setCorrectOptions((current) => current.map((selected, selectedIndex) => selectedIndex === questionIndex ? index : selected))
                          setChanged(true)
                        }}
                        className="shrink-0"
                      >
                        {letter}
                      </Button>
                      <Input
                        value={option}
                        aria-label={`Question ${selectedQuestion} option ${letter}`}
                        placeholder={`Option ${letter}`}
                        onChange={(event) => updateOption(index, event.target.value)}
                      />
                      {isBlankOption ? (
                        <span className="h-11 w-11 shrink-0" aria-hidden="true" />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`Delete option ${letter}`}
                          onClick={() => removeOption(index)}
                          disabled={filledOptionCount <= 2}
                          className="shrink-0 px-2 text-text-muted hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-md bg-surface-2 p-3 sm:p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Student response</p>
                  <div className="mt-2 min-h-24 rounded-md border border-dashed border-border-strong bg-surface px-3 py-3 text-sm text-text-muted">
                    {responseFormat === 'Code response'
                      ? 'Students write and format code in a monospace response field.'
                      : 'Students write a paragraph response in a standard text field.'}
                  </div>
                </div>
                <FormField label="Answer key" hint="Used for teacher and AI-assisted grading.">
                  <textarea
                    value={answerKeys[questionIndex]}
                    aria-label="Answer key"
                    onChange={(event) => {
                      setAnswerKeys((current) => current.map((value, index) => index === questionIndex ? event.target.value : value))
                      setChanged(true)
                    }}
                    className="min-h-24 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </FormField>
                <FormField label="Sample solution" hint="Shown to students when the test is returned.">
                  <textarea
                    value={sampleSolutions[questionIndex]}
                    aria-label="Sample solution"
                    onChange={(event) => {
                      setSampleSolutions((current) => current.map((value, index) => index === questionIndex ? event.target.value : value))
                      setChanged(true)
                    }}
                    className="min-h-28 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </FormField>
              </div>
            )}

              </>
            )}
          </div>
        </div>
      </CreationModalShell>

      <DialogPanel
        isOpen={open && textReferenceEditor !== null}
        onClose={() => setTextReferenceEditor(null)}
        maxWidth="max-w-xl"
        ariaLabelledBy="pattern-test-text-reference-title"
      >
        <h4 id="pattern-test-text-reference-title" className="shrink-0 text-base font-semibold text-text-default">
          {textReferenceEditor?.id ? 'Edit document' : 'Add Document'}
        </h4>
        <div className="mt-4 min-h-0 space-y-3 overflow-y-auto">
          <FormField label="Document title" required>
            <Input
              data-modal-initial-focus
              value={textReferenceEditor?.title || ''}
              placeholder="Title"
              maxLength={120}
              onChange={(event) => {
                setTextReferenceEditor((current) => current ? { ...current, title: event.target.value } : current)
                setTextReferenceError('')
              }}
            />
          </FormField>
          <FormField label="Document text" required hint="Markdown formatting is supported. Inline images are not supported.">
            <textarea
              value={textReferenceEditor?.content || ''}
              placeholder="Paste text students can reference during the test..."
              rows={6}
              maxLength={MAX_TEST_DOCUMENT_TEXT_LENGTH}
              onChange={(event) => {
                setTextReferenceEditor((current) => current ? { ...current, content: event.target.value } : current)
                setTextReferenceError('')
              }}
              className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </FormField>
          <p className="text-xs text-text-muted">
            {textReferenceEditor?.content.length || 0}/{MAX_TEST_DOCUMENT_TEXT_LENGTH} characters
          </p>
          {textReferenceError ? <p role="alert" className="text-sm text-danger">{textReferenceError}</p> : null}
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setTextReferenceEditor(null)}>Cancel</Button>
          <Button type="button" onClick={saveTextReference}>
            {textReferenceEditor?.id ? 'Save' : 'Add text'}
          </Button>
        </div>
      </DialogPanel>

      {open && previewOpen ? (
        <TeacherTestPreviewPage
          classroomId="pattern-lab"
          testId={PROTOTYPE_TEST_ID}
          draftPreview={previewDraft}
          embedded
          onClose={closeFullTestPreview}
        />
      ) : null}
    </section>
  )
}
