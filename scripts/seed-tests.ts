import type { SupabaseClient } from '@supabase/supabase-js'

interface SeedStudent {
  id: string
  email: string
}

interface SeedSampleTestsInput {
  supabase: SupabaseClient
  classroomId: string
  teacherId: string
  students: SeedStudent[]
}

function formatSupabaseError(error: any): string {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (error.message) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isMissingTestsSchemaError(error: any): boolean {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    message.includes('tests') ||
    message.includes('test_questions') ||
    message.includes('test_responses') ||
    message.includes('test_attempts')
  )
}

export async function seedSampleTests(input: SeedSampleTestsInput) {
  const { supabase, classroomId, teacherId, students } = input
  const [student1, student2] = students
  if (!student1 || !student2) {
    throw new Error('Need at least 2 students to seed sample tests')
  }

  console.log('Creating sample tests...')

  const { error: cleanupError } = await supabase
    .from('tests')
    .delete()
    .eq('classroom_id', classroomId)

  if (cleanupError) {
    if (isMissingTestsSchemaError(cleanupError)) {
      throw new Error(
        'Test seed requires test migrations (039-044). Apply migrations, then run seed again.'
      )
    }
    throw new Error(`Delete existing tests failed: ${formatSupabaseError(cleanupError)}`)
  }

  const testsToCreate = [
    {
      classroom_id: classroomId,
      title: 'Seed Test - AI Grading Demo',
      status: 'closed' as const,
      show_results: false,
      position: 0,
      points_possible: 20,
      include_in_final: true,
      created_by: teacherId,
    },
    {
      classroom_id: classroomId,
      title: 'Seed Test - Unattempted Demo',
      status: 'active' as const,
      show_results: false,
      position: 1,
      points_possible: 20,
      include_in_final: true,
      created_by: teacherId,
    },
  ]

  const { data: createdTests, error: createTestsError } = await supabase
    .from('tests')
    .insert(testsToCreate)
    .select('id, title, status')

  if (createTestsError || !createdTests || createdTests.length < 2) {
    if (isMissingTestsSchemaError(createTestsError)) {
      throw new Error(
        'Test seed requires test migrations (039-044). Apply migrations, then run seed again.'
      )
    }
    throw new Error(`Create sample tests failed: ${formatSupabaseError(createTestsError)}`)
  }

  const gradedTest = createdTests.find((test) => test.title === 'Seed Test - AI Grading Demo')
  const blankTest = createdTests.find((test) => test.title === 'Seed Test - Unattempted Demo')
  if (!gradedTest || !blankTest) {
    throw new Error('Failed to resolve created sample tests')
  }

  const questionsToCreate = [
    {
      test_id: gradedTest.id,
      question_type: 'multiple_choice' as const,
      question_text: 'Which time complexity is linear?',
      options: ['O(1)', 'O(n)', 'O(n^2)', 'O(log n)'],
      correct_option: 1,
      points: 2,
      response_max_chars: 5000,
      response_monospace: false,
      position: 0,
      answer_key: null,
    },
    {
      test_id: gradedTest.id,
      question_type: 'open_response' as const,
      question_text: 'In 2-4 sentences, explain what an API is and why idempotency matters for PUT requests.',
      options: [],
      correct_option: null,
      points: 5,
      response_max_chars: 2500,
      response_monospace: false,
      position: 1,
      answer_key: 'An API defines how clients and servers communicate. PUT should be idempotent so repeating the same request does not create additional side effects beyond the first successful update.',
    },
    {
      test_id: gradedTest.id,
      question_type: 'open_response' as const,
      question_text: 'Describe one practical trade-off of static typing in larger codebases.',
      options: [],
      correct_option: null,
      points: 5,
      response_max_chars: 2500,
      response_monospace: false,
      position: 2,
      answer_key: null,
    },
    {
      test_id: gradedTest.id,
      question_type: 'open_response' as const,
      question_text: 'JavaScript: write a function that returns the first duplicate number in an array, or -1 if none.',
      options: [],
      correct_option: null,
      points: 8,
      response_max_chars: 8000,
      response_monospace: true,
      position: 3,
      answer_key: null,
    },
    {
      test_id: blankTest.id,
      question_type: 'multiple_choice' as const,
      question_text: 'Which HTTP method is usually used for partial updates?',
      options: ['GET', 'POST', 'PATCH', 'DELETE'],
      correct_option: 2,
      points: 2,
      response_max_chars: 5000,
      response_monospace: false,
      position: 0,
      answer_key: null,
    },
    {
      test_id: blankTest.id,
      question_type: 'open_response' as const,
      question_text: 'Explain one benefit of writing tests before implementation.',
      options: [],
      correct_option: null,
      points: 4,
      response_max_chars: 2500,
      response_monospace: false,
      position: 1,
      answer_key: 'Writing tests first clarifies expected behavior and catches regressions early while design is still flexible.',
    },
    {
      test_id: blankTest.id,
      question_type: 'open_response' as const,
      question_text: 'Python: write pseudocode or code to count vowels in a string.',
      options: [],
      correct_option: null,
      points: 4,
      response_max_chars: 6000,
      response_monospace: true,
      position: 2,
      answer_key: null,
    },
  ]

  const { data: createdQuestions, error: createQuestionsError } = await supabase
    .from('test_questions')
    .insert(questionsToCreate)
    .select('id, test_id, position')

  if (createQuestionsError || !createdQuestions) {
    throw new Error(`Create sample test questions failed: ${formatSupabaseError(createQuestionsError)}`)
  }

  const questionIdByKey = new Map<string, string>()
  for (const question of createdQuestions) {
    questionIdByKey.set(`${question.test_id}:${question.position}`, question.id)
  }

  const gradedQ1 = questionIdByKey.get(`${gradedTest.id}:0`)
  const gradedQ2 = questionIdByKey.get(`${gradedTest.id}:1`)
  const gradedQ3 = questionIdByKey.get(`${gradedTest.id}:2`)
  const gradedQ4 = questionIdByKey.get(`${gradedTest.id}:3`)
  if (!gradedQ1 || !gradedQ2 || !gradedQ3 || !gradedQ4) {
    throw new Error('Failed to resolve grading demo question ids')
  }

  const submittedAtStudent1 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const submittedAtStudent2 = new Date(Date.now() - 90 * 60 * 1000).toISOString()

  const responsesToCreate = [
    {
      test_id: gradedTest.id,
      question_id: gradedQ1,
      student_id: student1.id,
      selected_option: 1,
      response_text: null,
      score: 2,
      feedback: null,
      graded_at: submittedAtStudent1,
      graded_by: null,
      submitted_at: submittedAtStudent1,
    },
    {
      test_id: gradedTest.id,
      question_id: gradedQ2,
      student_id: student1.id,
      selected_option: null,
      response_text: 'An API is a contract that defines requests and responses between systems. Idempotent PUT calls matter because retrying the same request should keep the resource in the same state instead of creating extra side effects.',
      score: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      submitted_at: submittedAtStudent1,
    },
    {
      test_id: gradedTest.id,
      question_id: gradedQ3,
      student_id: student1.id,
      selected_option: null,
      response_text: 'Static typing catches many integration errors before runtime, but it can slow early prototyping because types need to be modeled up front.',
      score: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      submitted_at: submittedAtStudent1,
    },
    {
      test_id: gradedTest.id,
      question_id: gradedQ4,
      student_id: student1.id,
      selected_option: null,
      response_text: `function firstDuplicate(values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return -1;
}`,
      score: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      submitted_at: submittedAtStudent1,
    },
    {
      test_id: gradedTest.id,
      question_id: gradedQ1,
      student_id: student2.id,
      selected_option: 0,
      response_text: null,
      score: 0,
      feedback: null,
      graded_at: submittedAtStudent2,
      graded_by: null,
      submitted_at: submittedAtStudent2,
    },
    {
      test_id: gradedTest.id,
      question_id: gradedQ2,
      student_id: student2.id,
      selected_option: null,
      response_text: 'API lets apps talk. PUT should not duplicate updates if sent again.',
      score: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      submitted_at: submittedAtStudent2,
    },
    {
      test_id: gradedTest.id,
      question_id: gradedQ4,
      student_id: student2.id,
      selected_option: null,
      response_text: `function f(a){let x={};for(let i=0;i<a.length;i++){if(x[a[i]]) return a[i];x[a[i]]=1}return -1}`,
      score: null,
      feedback: null,
      graded_at: null,
      graded_by: null,
      submitted_at: submittedAtStudent2,
    },
  ]

  const { error: createResponsesError } = await supabase
    .from('test_responses')
    .insert(responsesToCreate)

  if (createResponsesError) {
    throw new Error(`Create sample test responses failed: ${formatSupabaseError(createResponsesError)}`)
  }

  const attemptsToCreate = [
    {
      test_id: gradedTest.id,
      student_id: student1.id,
      responses: {},
      is_submitted: true,
      submitted_at: submittedAtStudent1,
    },
    {
      test_id: gradedTest.id,
      student_id: student2.id,
      responses: {},
      is_submitted: true,
      submitted_at: submittedAtStudent2,
    },
  ]

  const { error: createAttemptsError } = await supabase
    .from('test_attempts')
    .insert(attemptsToCreate)

  if (createAttemptsError) {
    throw new Error(`Create sample test attempts failed: ${formatSupabaseError(createAttemptsError)}`)
  }

  console.log(`✓ Created ${createdTests.length} sample tests`)
  console.log(`✓ Created ${createdQuestions.length} sample test questions`)
  console.log(`✓ Created ${responsesToCreate.length} sample test responses`)
  console.log('  - Demo test has mixed MC + open + coding responses ready for AI grading')
  console.log('  - Unattempted demo test is active with no responses\n')
}
