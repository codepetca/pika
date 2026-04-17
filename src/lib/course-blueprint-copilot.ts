import {
  courseBlueprintAssignmentsToMarkdown,
  type CourseBlueprintAssignmentMarkdownRecord,
} from '@/lib/course-blueprint-assignments'
import {
  courseBlueprintAssessmentsToMarkdown,
  type CourseBlueprintAssessmentMarkdownRecord,
} from '@/lib/course-blueprint-assessments-markdown'
import {
  courseBlueprintLessonTemplatesToMarkdown,
  type CourseBlueprintLessonTemplateMarkdownRecord,
} from '@/lib/course-blueprint-lesson-templates'
import type { CourseBlueprintDetail } from '@/types'
import { analyzeCourseBlueprintCompleteness } from '@/lib/course-blueprint-package'
import type { QuizDraftContent, TestDraftContent } from '@/lib/server/assessment-drafts'
import { DEFAULT_OPEN_RESPONSE_MAX_CHARS } from '@/lib/test-attempts'

type SuggestTarget =
  | 'analyze'
  | 'overview'
  | 'outline'
  | 'resources'
  | 'assignments'
  | 'quizzes'
  | 'tests'
  | 'lesson-plans'

export function suggestCourseBlueprintDraft(
  detail: CourseBlueprintDetail,
  target: SuggestTarget,
  prompt: string
) {
  const analysis = analyzeCourseBlueprintCompleteness(detail)
  const promptNote = prompt.trim() ? `\n\nTeacher note: ${prompt.trim()}` : ''

  if (target === 'analyze') {
    return {
      target,
      content: '',
      analysis,
    }
  }

  if (target === 'overview') {
    return {
      target,
      content: `# ${detail.title}

## Overview
This course blueprint is designed for ${detail.grade_level || 'the target grade level'} learners in ${detail.subject || 'this subject area'}.

## What Students Will Do
- Build understanding through recurring assignments and short assessments.
- Practice course skills in class and through independent work.
- Use teacher-provided resources and lesson sequences to stay on track.

## Teacher Use
- Start each new classroom from this blueprint.
- Review the outline, then adapt pacing and due dates for the term.
- Add or revise artifacts as the course evolves.${promptNote}`.trim(),
      analysis,
    }
  }

  if (target === 'outline') {
    const lines = [
      `# ${detail.title} Outline`,
      '',
      '## Course Sequence',
      '- Course launch and expectations',
      '- Core skill building',
      '- Applied practice and checkpoints',
      '- Consolidation and final evaluation',
    ]

    const artifactTitles = [
      ...detail.assignments.slice(0, 4).map((assignment) => assignment.title),
      ...detail.assessments.slice(0, 4).map((assessment) => assessment.title),
    ]
    if (artifactTitles.length > 0) {
      lines.push('', '## Existing Reusable Artifacts')
      artifactTitles.forEach((title) => lines.push(`- ${title}`))
    }
    if (promptNote) lines.push('', promptNote.trim())

    return {
      target,
      content: lines.join('\n'),
      analysis,
    }
  }

  if (target === 'resources') {
    return {
      target,
      content: `# Course Resources

## Teacher Contact
- Add office hours and preferred contact method.

## Core Materials
- Course homepage or LMS link
- Required software, texts, or accounts
- Ongoing reference sheets or exemplars

## Success Supports
- Assignment checklist
- Assessment preparation reminders
- Academic integrity expectations${promptNote}`.trim(),
      analysis,
    }
  }

  if (target === 'assignments') {
    const assignments: CourseBlueprintAssignmentMarkdownRecord[] = [
      {
        title: `${detail.subject || detail.title} kickoff reflection`,
        instructions_markdown: 'Students introduce themselves, summarize prior experience, and identify one learning goal for the course.',
        default_due_days: 5,
        default_due_time: '23:59',
        points_possible: 10,
        include_in_final: true,
        is_draft: true,
        position: 0,
      },
      {
        title: `${detail.subject || detail.title} practice task`,
        instructions_markdown: 'Students complete a short guided task that demonstrates the core process or concept for the next stretch of the course.',
        default_due_days: 12,
        default_due_time: '23:59',
        points_possible: 20,
        include_in_final: true,
        is_draft: true,
        position: 1,
      },
      {
        title: `${detail.subject || detail.title} applied checkpoint`,
        instructions_markdown: `Students apply recent learning in a more open-ended task and submit a polished response.${promptNote ? `\n\n${promptNote.trim()}` : ''}`,
        default_due_days: 20,
        default_due_time: '23:59',
        points_possible: 30,
        include_in_final: true,
        is_draft: true,
        position: 2,
      },
    ]

    return {
      target,
      content: courseBlueprintAssignmentsToMarkdown(assignments),
      analysis,
    }
  }

  if (target === 'quizzes') {
    const quizzes: CourseBlueprintAssessmentMarkdownRecord[] = [
      {
        assessment_type: 'quiz',
        title: `${detail.subject || detail.title} check-in quiz`,
        content: {
          title: `${detail.subject || detail.title} check-in quiz`,
          show_results: false,
          questions: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              question_text: 'Which concept from the opening lessons is most important to remember?',
              options: ['Concept A', 'Concept B', 'Concept C', 'Concept D'],
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              question_text: 'Which process should students follow first when starting a task?',
              options: ['Plan', 'Submit', 'Ignore instructions', 'Restart without checking'],
            },
          ],
        } satisfies QuizDraftContent,
        documents: [],
        position: 0,
      },
    ]

    return {
      target,
      content: courseBlueprintAssessmentsToMarkdown(quizzes, 'quiz'),
      analysis,
    }
  }

  if (target === 'tests') {
    const tests: CourseBlueprintAssessmentMarkdownRecord[] = [
      {
        assessment_type: 'test',
        title: `${detail.subject || detail.title} unit test`,
        content: {
          title: `${detail.subject || detail.title} unit test`,
          show_results: false,
          questions: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              question_type: 'multiple_choice',
              question_text: 'Which answer best reflects the main idea from this stretch of the course?',
              options: ['Choice A', 'Choice B', 'Choice C', 'Choice D'],
              correct_option: 0,
              answer_key: null,
              sample_solution: null,
              points: 1,
              response_max_chars: DEFAULT_OPEN_RESPONSE_MAX_CHARS,
              response_monospace: false,
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              question_type: 'open_response',
              question_text: `Explain the reasoning behind an important skill or idea from the course.${promptNote ? ` ${promptNote.trim()}` : ''}`.trim(),
              options: [],
              correct_option: null,
              answer_key: 'A strong answer should name the concept, explain the reasoning, and connect it to classroom practice.',
              sample_solution: null,
              points: 5,
              response_max_chars: DEFAULT_OPEN_RESPONSE_MAX_CHARS,
              response_monospace: false,
            },
          ],
          source_format: 'markdown' as const,
        } satisfies TestDraftContent,
        documents: [],
        position: 0,
      },
    ]

    return {
      target,
      content: courseBlueprintAssessmentsToMarkdown(tests, 'test'),
      analysis,
    }
  }

  const lessonTemplates: CourseBlueprintLessonTemplateMarkdownRecord[] = [
    {
      title: 'Course launch',
      content_markdown: 'Introduce the course, review expectations, and surface prior knowledge.',
      position: 0,
    },
    {
      title: 'Guided practice',
      content_markdown: 'Model the main skill, then give students structured practice with feedback.',
      position: 1,
    },
    {
      title: 'Independent application',
      content_markdown: `Students apply the recent learning in an individual or paired task.${promptNote ? `\n\n${promptNote.trim()}` : ''}`,
      position: 2,
    },
  ]

  return {
    target,
    content: courseBlueprintLessonTemplatesToMarkdown(lessonTemplates),
    analysis,
  }
}
