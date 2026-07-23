import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const retiredModules = [
  '@/lib/server/assessments',
  '@/lib/server/quizzes',
  '@/lib/quizzes',
]
const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
const sourceRoot = `${path.join(root, 'src')}${path.sep}`
const sourceFiles = parsedConfig.fileNames.filter((file) => file.startsWith(sourceRoot))
const program = ts.createProgram(sourceFiles, parsedConfig.options)
const checker = program.getTypeChecker()

function exportedLocations(name: string): string[] {
  const locations: string[] = []

  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(sourceRoot)) continue
    const symbol = checker.getSymbolAtLocation(source)
    if (!symbol) continue
    if (checker.getExportsOfModule(symbol).some((entry) => entry.name === name)) {
      locations.push(path.relative(root, source.fileName))
    }
  }

  return locations
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

  it('does not expose retired quiz aliases from any source module', () => {
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
      'withLegacyQuizKey',
      'withLegacyQuizListKey',
    ]
    const retiredDraftAliases = [
      'buildQuizDraftContentFromRows',
      'syncQuizQuestionsFromDraft',
      'validateQuizDraftContent',
    ]

    for (const alias of [
      ...retiredTypeAliases,
      ...retiredHelperAliases,
      ...retiredMarkdownAliases,
      ...retiredDraftAliases,
    ]) {
      expect(exportedLocations(alias), `${alias} is exported`).toEqual([])
    }
  })
})
