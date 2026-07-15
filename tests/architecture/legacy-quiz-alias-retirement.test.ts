import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const retiredModules = [
  '@/lib/server/assessments',
  '@/lib/server/quizzes',
  '@/lib/quizzes',
]
const exportModules = [
  'src/types/index.ts',
  'src/lib/assessments.ts',
  'src/lib/quiz-markdown.ts',
]

const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
const program = ts.createProgram(
  exportModules.map((file) => path.join(root, file)),
  parsedConfig.options
)
const checker = program.getTypeChecker()

function exportedNames(file: string): Set<string> {
  const source = program.getSourceFile(path.join(root, file))
  if (!source) throw new Error(`TypeScript program did not load ${file}`)
  const symbol = checker.getSymbolAtLocation(source)
  if (!symbol) throw new Error(`TypeScript checker did not resolve ${file}`)
  return new Set(checker.getExportsOfModule(symbol).map((entry) => entry.name))
}

describe('legacy quiz alias retirement', () => {
  it('does not restore the unused quiz server and re-export modules', () => {
    const containingFile = path.join(root, 'tests/architecture/legacy-quiz-alias-retirement.test.ts')

    for (const moduleName of retiredModules) {
      const resolution = ts.resolveModuleName(
        moduleName,
        containingFile,
        parsedConfig.options,
        ts.sys
      ).resolvedModule
      expect(resolution, `${moduleName} unexpectedly resolves`).toBeUndefined()
    }
  })

  it('keeps test-domain types and helpers on their current names', () => {
    const typeExports = exportedNames('src/types/index.ts')
    const assessmentExports = exportedNames('src/lib/assessments.ts')
    const markdownExports = exportedNames('src/lib/quiz-markdown.ts')
    const retiredTypeAliases = [
      'QuizDraftQuestion',
      'QuizDraftContent',
      'QuizStatus',
      'QuizAssessmentType',
      'QuizFocusEventType',
      'QuizFocusSummary',
      'Quiz',
      'QuizQuestion',
      'QuizResponse',
      'QuizWithQuestions',
      'QuizWithStats',
      'StudentQuizStatus',
      'StudentQuizView',
      'QuizResultsAggregate',
    ]
    const retiredMarkdownAliases = [
      'QuizMarkdownSerializeInput',
      'QuizMarkdownParseOptions',
      'QuizMarkdownParseResult',
    ]
    const retiredHelperAliases = [
      'getStudentQuizStatus',
      'getQuizStatusLabel',
      'getQuizStatusBadgeClass',
      'getQuizAssessmentType',
      'canEditQuizQuestions',
      'MAX_QUIZ_OPTIONS',
      'validateQuizOptions',
      'canActivateQuiz',
      'QUIZ_EXIT_BURST_WINDOW_MS',
      'getQuizExitCount',
      'emptyQuizFocusSummary',
      'summarizeQuizFocusEvents',
    ]

    for (const alias of retiredTypeAliases) {
      expect(typeExports).not.toContain(alias)
    }
    for (const alias of retiredHelperAliases) {
      expect(assessmentExports).not.toContain(alias)
    }
    for (const alias of retiredMarkdownAliases) {
      expect(markdownExports).not.toContain(alias)
    }
  })
})
