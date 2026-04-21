import type { TestOpenResponsePromptProfile } from '@/lib/ai-test-grading'

export type GoldSetQuestionType = 'coding' | 'non-coding'

export interface TestAiGradingGoldFixture {
  id: string
  label: string
  questionType: GoldSetQuestionType
  testTitle: string
  questionText: string
  maxPoints: number
  responseMonospace: boolean
  answerKey: string
  sampleSolution?: string
  responseText: string
  acceptedScoreRange: {
    min: number
    max: number
  }
  rationale: string
}

export const TEST_AI_GOLD_SET_REVIEW_STATUS = 'pending_teacher_review'

const codingVowels = {
  testTitle: 'Grade 11 CS Unit 3',
  questionText: 'Write a method countVowels(String s) that returns the number of vowels in the string.',
  maxPoints: 5,
  responseMonospace: true,
  answerKey: 'Loop through the string, check each character against the vowels a/e/i/o/u, and increment a counter before returning it.',
  sampleSolution:
    'public int countVowels(String s) {\n  int count = 0;\n  for (int i = 0; i < s.length(); i++) {\n    char ch = Character.toLowerCase(s.charAt(i));\n    if (ch == \'a\' || ch == \'e\' || ch == \'i\' || ch == \'o\' || ch == \'u\') {\n      count++;\n    }\n  }\n  return count;\n}',
} as const

const codingReverse = {
  testTitle: 'Grade 11 CS Unit 3',
  questionText: 'Write a method reverseWord(String word) that returns the letters of word in reverse order.',
  maxPoints: 5,
  responseMonospace: true,
  answerKey: 'Build and return a reversed string by iterating from the last character to the first.',
  sampleSolution:
    'public String reverseWord(String word) {\n  String result = "";\n  for (int i = word.length() - 1; i >= 0; i--) {\n    result += word.substring(i, i + 1);\n  }\n  return result;\n}',
} as const

const codingMax = {
  testTitle: 'Grade 11 CS Unit 5',
  questionText: 'Write a method maxValue(int[] nums) that returns the largest value in the array.',
  maxPoints: 5,
  responseMonospace: true,
  answerKey: 'Initialize max from the array, loop through all items, and replace max whenever a larger value appears.',
  sampleSolution:
    'public int maxValue(int[] nums) {\n  int max = nums[0];\n  for (int i = 1; i < nums.length; i++) {\n    if (nums[i] > max) {\n      max = nums[i];\n    }\n  }\n  return max;\n}',
} as const

const codingAverage = {
  testTitle: 'Grade 11 CS Unit 5',
  questionText: 'Write a method averagePositive(int[] nums) that returns the average of the positive numbers in nums.',
  maxPoints: 6,
  responseMonospace: true,
  answerKey: 'Track sum and count for values greater than zero, then return sum / count using a positive-only average.',
  sampleSolution:
    'public double averagePositive(int[] nums) {\n  int sum = 0;\n  int count = 0;\n  for (int i = 0; i < nums.length; i++) {\n    if (nums[i] > 0) {\n      sum += nums[i];\n      count++;\n    }\n  }\n  return (double) sum / count;\n}',
} as const

const nonCodingOsmosis = {
  testTitle: 'Biology Unit Test',
  questionText: 'Explain osmosis.',
  maxPoints: 5,
  responseMonospace: false,
  answerKey: 'Osmosis is the movement of water across a semipermeable membrane from an area of lower solute concentration to higher solute concentration.',
} as const

const nonCodingInheritance = {
  testTitle: 'Intro CS Concepts Quiz',
  questionText: 'Explain what inheritance means in object-oriented programming.',
  maxPoints: 5,
  responseMonospace: false,
  answerKey: 'Inheritance lets a subclass reuse and extend the fields and methods of a superclass.',
} as const

export const TEST_AI_GRADING_GOLD_SET: TestAiGradingGoldFixture[] = [
  {
    id: 'coding-vowels-full',
    label: 'Counts vowels correctly',
    ...codingVowels,
    responseText:
      'public int countVowels(String s) {\n  int count = 0;\n  for (int i = 0; i < s.length(); i++) {\n    char ch = Character.toLowerCase(s.charAt(i));\n    if (ch == \'a\' || ch == \'e\' || ch == \'i\' || ch == \'o\' || ch == \'u\') {\n      count++;\n    }\n  }\n  return count;\n}',
    acceptedScoreRange: { min: 5, max: 5 },
    rationale: 'Fully correct counted-loop solution with clear structure.',
  },
  {
    id: 'coding-vowels-syntax-partial',
    label: 'Correct logic with minor syntax issues',
    ...codingVowels,
    responseText:
      'public int countVowels(String s) {\n  int count = 0\n  for (int i = 0; i < s.length(); i++) {\n    char ch = Character.toLowerCase(s.charAt(i));\n    if (ch == \'a\' || ch == \'e\' || ch == \'i\' || ch == \'o\' || ch == \'u\') {\n      count++;\n    }\n  }\n  return count;\n}',
    acceptedScoreRange: { min: 4, max: 5 },
    rationale: 'Core logic is correct; only beginner syntax polish is missing.',
  },
  {
    id: 'coding-vowels-partial',
    label: 'Counts only lowercase vowels',
    ...codingVowels,
    responseText:
      'public int countVowels(String s) {\n  int count = 0;\n  for (int i = 0; i < s.length(); i++) {\n    char ch = s.charAt(i);\n    if (ch == \'a\' || ch == \'e\' || ch == \'i\' || ch == \'o\' || ch == \'u\') {\n      count++;\n    }\n  }\n  return count;\n}',
    acceptedScoreRange: { min: 3, max: 4 },
    rationale: 'Main method structure is right, but the solution misses uppercase handling.',
  },
  {
    id: 'coding-vowels-wrong',
    label: 'Returns string length instead of vowel count',
    ...codingVowels,
    responseText:
      'public int countVowels(String s) {\n  return s.length();\n}',
    acceptedScoreRange: { min: 0, max: 1 },
    rationale: 'Does not address vowel detection or counting.',
  },
  {
    id: 'coding-reverse-full',
    label: 'Reverse with loop and concatenation',
    ...codingReverse,
    responseText:
      'public String reverseWord(String word) {\n  String result = "";\n  for (int i = word.length() - 1; i >= 0; i--) {\n    result += word.substring(i, i + 1);\n  }\n  return result;\n}',
    acceptedScoreRange: { min: 5, max: 5 },
    rationale: 'Matches the required reverse-loop approach exactly.',
  },
  {
    id: 'coding-reverse-alternate-valid',
    label: 'Alternate valid reverse using charAt',
    ...codingReverse,
    responseText:
      'public String reverseWord(String word) {\n  String result = "";\n  for (int i = word.length() - 1; i >= 0; i--) {\n    result += word.charAt(i);\n  }\n  return result;\n}',
    acceptedScoreRange: { min: 5, max: 5 },
    rationale: 'Alternate valid implementation that still satisfies the prompt.',
  },
  {
    id: 'coding-reverse-off-by-one',
    label: 'Mostly correct with off-by-one bug',
    ...codingReverse,
    responseText:
      'public String reverseWord(String word) {\n  String result = "";\n  for (int i = word.length() - 1; i > 0; i--) {\n    result += word.charAt(i);\n  }\n  return result;\n}',
    acceptedScoreRange: { min: 3, max: 4 },
    rationale: 'Reverse logic is clear, but the first character is skipped.',
  },
  {
    id: 'coding-reverse-empty',
    label: 'Blank coding response',
    ...codingReverse,
    responseText: '',
    acceptedScoreRange: { min: 0, max: 0 },
    rationale: 'Empty response should receive no credit.',
  },
  {
    id: 'coding-max-full',
    label: 'Correct maximum finder',
    ...codingMax,
    responseText:
      'public int maxValue(int[] nums) {\n  int max = nums[0];\n  for (int i = 1; i < nums.length; i++) {\n    if (nums[i] > max) {\n      max = nums[i];\n    }\n  }\n  return max;\n}',
    acceptedScoreRange: { min: 5, max: 5 },
    rationale: 'Correct initialization, loop bounds, comparison, and return.',
  },
  {
    id: 'coding-max-pseudocode',
    label: 'Pseudocode-like but logically correct',
    ...codingMax,
    responseText:
      'set max to first number\nloop through the rest of the array\nif the current number is bigger than max, update max\nreturn max',
    acceptedScoreRange: { min: 4, max: 5 },
    rationale: 'Logic is correct and clearly communicates the intended algorithm.',
  },
  {
    id: 'coding-max-partial',
    label: 'Compares values but never updates max',
    ...codingMax,
    responseText:
      'public int maxValue(int[] nums) {\n  int max = nums[0];\n  for (int i = 1; i < nums.length; i++) {\n    if (nums[i] > max) {\n      System.out.println(nums[i]);\n    }\n  }\n  return max;\n}',
    acceptedScoreRange: { min: 2, max: 3 },
    rationale: 'Shows the comparison idea but fails to store the new maximum.',
  },
  {
    id: 'coding-max-wrong',
    label: 'Returns first element only',
    ...codingMax,
    responseText:
      'public int maxValue(int[] nums) {\n  return nums[0];\n}',
    acceptedScoreRange: { min: 0, max: 1 },
    rationale: 'No iteration or max-finding logic is present.',
  },
  {
    id: 'coding-average-full',
    label: 'Correct average of positive numbers',
    ...codingAverage,
    responseText:
      'public double averagePositive(int[] nums) {\n  int sum = 0;\n  int count = 0;\n  for (int i = 0; i < nums.length; i++) {\n    if (nums[i] > 0) {\n      sum += nums[i];\n      count++;\n    }\n  }\n  return (double) sum / count;\n}',
    acceptedScoreRange: { min: 6, max: 6 },
    rationale: 'Correctly tracks positives and computes the final average.',
  },
  {
    id: 'coding-average-high-partial',
    label: 'Correct core logic with rough formatting',
    ...codingAverage,
    responseText:
      'public double averagePositive(int[] nums) { int sum = 0; int count = 0; for (int i = 0; i < nums.length; i++) { if (nums[i] > 0) { sum += nums[i]; count++; } } return (double) sum / count; }',
    acceptedScoreRange: { min: 5, max: 6 },
    rationale: 'Logic is correct; readability is weaker but should only reduce score slightly if at all.',
  },
  {
    id: 'coding-average-missing-count',
    label: 'Adds positives but forgets to divide',
    ...codingAverage,
    responseText:
      'public double averagePositive(int[] nums) {\n  int sum = 0;\n  for (int i = 0; i < nums.length; i++) {\n    if (nums[i] > 0) {\n      sum += nums[i];\n    }\n  }\n  return sum;\n}',
    acceptedScoreRange: { min: 2, max: 4 },
    rationale: 'Captures part of the required process but does not compute an average.',
  },
  {
    id: 'coding-average-wrong',
    label: 'Averages all numbers, not positives only',
    ...codingAverage,
    responseText:
      'public double averagePositive(int[] nums) {\n  int sum = 0;\n  for (int i = 0; i < nums.length; i++) {\n    sum += nums[i];\n  }\n  return (double) sum / nums.length;\n}',
    acceptedScoreRange: { min: 1, max: 3 },
    rationale: 'Shows averaging structure but ignores the positive-only requirement.',
  },
  {
    id: 'noncoding-osmosis-full',
    label: 'Accurate osmosis explanation',
    ...nonCodingOsmosis,
    responseText:
      'Osmosis is when water moves across a semipermeable membrane from the side with lower solute concentration to the side with higher solute concentration.',
    acceptedScoreRange: { min: 5, max: 5 },
    rationale: 'Includes membrane plus correct direction of water movement.',
  },
  {
    id: 'noncoding-osmosis-partial',
    label: 'Core idea without concentration detail',
    ...nonCodingOsmosis,
    responseText:
      'Osmosis is when water moves through a membrane to balance things out.',
    acceptedScoreRange: { min: 3, max: 4 },
    rationale: 'Captures membrane movement but lacks precise concentration language.',
  },
  {
    id: 'noncoding-osmosis-misconception',
    label: 'Moves salt instead of water',
    ...nonCodingOsmosis,
    responseText:
      'Osmosis is when salt moves across the membrane from high concentration to low concentration.',
    acceptedScoreRange: { min: 0, max: 1 },
    rationale: 'Confuses the substance that moves and gives the wrong explanation.',
  },
  {
    id: 'noncoding-osmosis-empty',
    label: 'Empty osmosis response',
    ...nonCodingOsmosis,
    responseText: '',
    acceptedScoreRange: { min: 0, max: 0 },
    rationale: 'Empty response should earn zero.',
  },
  {
    id: 'noncoding-inheritance-full',
    label: 'Clear inheritance definition',
    ...nonCodingInheritance,
    responseText:
      'Inheritance means a subclass can reuse the fields and methods of a superclass and also add or override behavior.',
    acceptedScoreRange: { min: 5, max: 5 },
    rationale: 'Explains reuse plus extension clearly.',
  },
  {
    id: 'noncoding-inheritance-alt-wording',
    label: 'Equivalent wording for inheritance',
    ...nonCodingInheritance,
    responseText:
      'A child class gets the properties and behaviors of a parent class, which lets it build on code that already exists.',
    acceptedScoreRange: { min: 4, max: 5 },
    rationale: 'Equivalent meaning with different wording should still earn high credit.',
  },
  {
    id: 'noncoding-inheritance-partial',
    label: 'Talks about copying code only',
    ...nonCodingInheritance,
    responseText:
      'Inheritance is when you copy code from one class into another class.',
    acceptedScoreRange: { min: 1, max: 2 },
    rationale: 'Shows a weak idea of reuse but misses the class relationship and extension behavior.',
  },
  {
    id: 'noncoding-inheritance-wrong',
    label: 'Confuses inheritance with encapsulation',
    ...nonCodingInheritance,
    responseText:
      'Inheritance is when a class hides its data using private variables.',
    acceptedScoreRange: { min: 0, max: 1 },
    rationale: 'Describes a different concept entirely.',
  },
]

export const TEST_AI_GOLD_SET_SUPPORTED_PROMPT_PROFILES: TestOpenResponsePromptProfile[] = [
  'manual',
  'bulk',
]
