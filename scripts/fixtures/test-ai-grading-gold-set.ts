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
  /**
   * Where the accepted range came from. Absent means the range was written when the
   * fixture was, never checked against a teacher, and so proves nothing when it passes.
   * `calibrated` means the range encodes a verdict a teacher gave on a real response.
   * Only calibrated fixtures gate the run.
   */
  provenance?: 'calibrated'
}

export const TEST_AI_GOLD_SET_REVIEW_STATUS = 'partially_teacher_calibrated'

const codingVowels = {
  questionType: 'coding',
  testTitle: 'Grade 11 CS Unit 3',
  questionText: 'Write a method countVowels(String s) that returns the number of vowels in the string.',
  maxPoints: 5,
  responseMonospace: true,
  answerKey: 'Loop through the string, check each character against the vowels a/e/i/o/u, and increment a counter before returning it.',
  sampleSolution:
    'public int countVowels(String s) {\n  int count = 0;\n  for (int i = 0; i < s.length(); i++) {\n    char ch = Character.toLowerCase(s.charAt(i));\n    if (ch == \'a\' || ch == \'e\' || ch == \'i\' || ch == \'o\' || ch == \'u\') {\n      count++;\n    }\n  }\n  return count;\n}',
} as const

const codingReverse = {
  questionType: 'coding',
  testTitle: 'Grade 11 CS Unit 3',
  questionText: 'Write a method reverseWord(String word) that returns the letters of word in reverse order.',
  maxPoints: 5,
  responseMonospace: true,
  answerKey: 'Build and return a reversed string by iterating from the last character to the first.',
  sampleSolution:
    'public String reverseWord(String word) {\n  String result = "";\n  for (int i = word.length() - 1; i >= 0; i--) {\n    result += word.substring(i, i + 1);\n  }\n  return result;\n}',
} as const

const codingMax = {
  questionType: 'coding',
  testTitle: 'Grade 11 CS Unit 5',
  questionText: 'Write a method maxValue(int[] nums) that returns the largest value in the array.',
  maxPoints: 5,
  responseMonospace: true,
  answerKey: 'Initialize max from the array, loop through all items, and replace max whenever a larger value appears.',
  sampleSolution:
    'public int maxValue(int[] nums) {\n  int max = nums[0];\n  for (int i = 1; i < nums.length; i++) {\n    if (nums[i] > max) {\n      max = nums[i];\n    }\n  }\n  return max;\n}',
} as const

const codingAverage = {
  questionType: 'coding',
  testTitle: 'Grade 11 CS Unit 5',
  questionText: 'Write a method averagePositive(int[] nums) that returns the average of the positive numbers in nums.',
  maxPoints: 6,
  responseMonospace: true,
  answerKey: 'Track sum and count for values greater than zero, then return sum / count using a positive-only average.',
  sampleSolution:
    'public double averagePositive(int[] nums) {\n  int sum = 0;\n  int count = 0;\n  for (int i = 0; i < nums.length; i++) {\n    if (nums[i] > 0) {\n      sum += nums[i];\n      count++;\n    }\n  }\n  return (double) sum / count;\n}',
} as const

// The five contexts below back the calibrated fixtures. Each reproduces the SHAPE of a
// defect found in real archived work — never the work itself. The responses are written
// here from scratch: the repository is public, and student submissions stay in the
// gitignored snapshots they were exported to.

const calibratedSongClass = {
  questionType: 'coding',
  testTitle: 'Calibration — Implementing a Class',
  questionText:
    'Implement the `Song` class.\n- Write the class signature.\n- Create a private `String` property for the title.\n- Create a private `int` property for the length in seconds.\n- Implement a constructor with two parameters that sets both.\n- Implement a getter for the title.\n- Implement a setter for the length that only updates when the new value is greater than 0.\n- Implement `isLong()` returning true when the song is at least 300 seconds.\n- Implement `toString()` returning `"title (seconds s)"`.',
  maxPoints: 9,
  responseMonospace: true,
  answerKey:
    '- Defines a valid `Song` class.\n- Declares private fields for title and length.\n- Constructor stores both values.\n- Getter for the title.\n- Setter for length that only accepts positive values.\n- `isLong()` returns whether the song is at least 300 seconds.\n- `toString()` in the required format.\n- Code is readable and logically organized.',
} as const

const calibratedCountUp = {
  questionType: 'coding',
  testTitle: 'Calibration — Implementing a Function',
  questionText:
    'Implement `countUpTo(x)`. It outputs the numbers from 1 up to `x`, one per line, using `console.log(...)`. It should not return a value.\n\nExample: `countUpTo(3)` outputs:\n1\n2\n3',
  maxPoints: 5,
  responseMonospace: true,
  answerKey:
    'Grading guide:\n- 1 point: defines `countUpTo(x)` correctly\n- 1 point: uses a loop that counts upward\n- 1 point: starts at 1\n- 1 point: outputs one value per line\n- 1 point: stops after outputting `x`',
} as const

const calibratedLibrary = {
  questionType: 'coding',
  testTitle: 'Calibration — Objects and Collections',
  questionText:
    'Write a `run` method using the Library API.\n- Create an instance named `fiction` using the fiction library data.\n- Create 3 instances of `Book`.\n- Attempt to add each book to `fiction`, outputting `true` if successful and `false` otherwise.\n- Output the library name and the titles of all books over 200 pages.\n- Instantiate a second library named `science` using the science library data.\n- Use a `for` loop to create and add 10 random books to `science`, outputting `true` or `false` each time.\n- Use `Randomizer.nextInt` to generate random page counts.',
  maxPoints: 10,
  responseMonospace: true,
  answerKey:
    '- Instantiates the fiction library using the provided data.\n- Instantiates 3 `Book` objects.\n- Calls the add API for each book and outputs the returned boolean each time.\n- Outputs the library name.\n- Outputs the titles of books over 200 pages using the API.\n- Instantiates `science` using the default-limit constructor.\n- Uses a `for` loop that runs 10 times.\n- Creates a new random book inside the loop.\n- Adds each random book to `science` and outputs the returned boolean.\n- Uses `Randomizer.nextInt` appropriately.',
  sampleSolution:
    'public void run() {\n  Library fiction = new Library("fiction", 2);\n  Book b1 = new Book("Dune", 412);\n  Book b2 = new Book("Holes", 233);\n  Book b3 = new Book("Hatchet", 195);\n\n  System.out.println(fiction.add(b1));\n  System.out.println(fiction.add(b2));\n  System.out.println(fiction.add(b3));\n\n  System.out.println(fiction.getName());\n  fiction.printTitlesOverPages(200);\n\n  Library science = new Library("science");\n  for (int i = 0; i < 10; i++) {\n    Book b = new Book("Book" + i, Randomizer.nextInt(80, 400));\n    System.out.println(science.add(b));\n  }\n}',
} as const

const calibratedVehicleInheritance = {
  questionType: 'coding',
  testTitle: 'Calibration — Inheritance',
  questionText:
    'Implement the `Vehicle` class.\n- Write the class signature.\n- Create a public class variable tracking the total number of vehicles.\n- Create a property for the price that can store decimal values.\n- The constructor takes one argument to set the price and increments the total.\n- Implement a `tax` method returning 10% of the price.\n\nThen implement `Truck`, which inherits from `Vehicle`.\n- Create a property for the payload capacity.\n- The constructor sets the price in the super class and the capacity.\n- Override `tax` to return 13% of the price.',
  maxPoints: 10,
  responseMonospace: true,
  answerKey:
    '- Defines a valid `Vehicle` class.\n- Declares a public class variable tracking total vehicles.\n- Declares a price property storing decimals.\n- Constructor stores the price and increments the class variable.\n- Implements `tax()` returning 10% of the price.\n- Defines `Truck` as a subclass of `Vehicle`.\n- Declares a capacity property in `Truck`.\n- Correctly calls `super(...)` and initializes capacity.\n- Correctly overrides `tax()` in `Truck` to return 13%.\n- Code is readable and logically organized.',
} as const

const nonCodingOsmosis = {
  questionType: 'non-coding',
  testTitle: 'Biology Unit Test',
  questionText: 'Explain osmosis.',
  maxPoints: 5,
  responseMonospace: false,
  answerKey: 'Osmosis is the movement of water across a semipermeable membrane from an area of lower solute concentration to higher solute concentration.',
} as const

const nonCodingInheritance = {
  questionType: 'non-coding',
  testTitle: 'Intro CS Concepts Test',
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

  // --- Calibrated fixtures ----------------------------------------------------------
  // Ranges below encode verdicts a teacher gave on real archived responses during the
  // 2026-09 calibration. Each reproduces a defect shape, not a submission. These are the
  // only fixtures that gate the run; see `provenance` on the interface above.

  {
    id: 'calibrated-transcription-tolerated',
    label: 'Complete class, two transcription slips',
    ...calibratedSongClass,
    provenance: 'calibrated',
    responseText:
      'public class Song\n{\n\tprivate String title;\n\tprivate int seconds;\n\n\tpublic Song(String theTitle, int theSeconds)\n\t{\n\t\ttitle = theTitle;\n\t\tseconds = theSeconds;\n\t}\n\tpublic String getTitle()\n\t{\n\t\treturn title;\n\t}\n\tpublic String setTitle(String text)\n\t{\n\t\ttitle = text;\n\t}\n\tpublic int setSeconds(int s)\n\t{\n\t\tif(s > 0)\n\t\t{\n\t\t\tseconds = s;\n\t\t}\n\t\treturn seconds;\n\t}\n\tpublic boolean isLong()\n\t{\n\t\tif(seconds >= 300)\n\t\t{\n\t\t\treturn true;\n\t\t}\n\t\treturn false;\n\t}\n\tpublic String toString()\n\t{\n\t\treturn title + " (" + seconds + " s)"\n\t}\n}',
    acceptedScoreRange: { min: 7, max: 9 },
    rationale:
      'Every required feature is present and the formatting is clean. Two compile errors — an unrequested setter declared String with no return, and a missing semicolon in toString. Handwritten on paper without a compiler, so transcription slips do not gut the score. Teacher adjudicated the equivalent real response at 8 of 9 against a recorded mark of 2.',
  },
  {
    id: 'calibrated-itemized-partial-credit',
    label: 'Runs, output off by one, some criteria still met',
    ...calibratedCountUp,
    provenance: 'calibrated',
    responseText:
      'function main(){\n\tconsole.log(countUpTo(3));\n}\n\nfunction countUpTo(x){\n\tvar num = 1;\n\tfor(var i = 1; i <= x; i++){\n\t\tconsole.log(num += 1);\n\t}\n}\n\nmain();',
    acceptedScoreRange: { min: 2, max: 4 },
    rationale:
      'Prints 2,3,4 instead of 1,2,3 — wrong at both ends. But the key is itemized and the response plainly satisfies "defines the function" and "one value per line". An itemized rubric pays out per criterion met; a wrong result does not zero the criteria the student did satisfy. Teacher adjudicated the equivalent real response at 3 of 5 against a recorded mark of 0.',
  },
  {
    id: 'calibrated-rubric-floor-six-met',
    label: 'Six of ten criteria met, two clear failures',
    ...calibratedLibrary,
    provenance: 'calibrated',
    responseText:
      'public void run() {\n\tLibrary fiction = new Library("fiction", 2);\n\tLibary science = new Library("science");\n\tBook b1 = new Book("Dune", 412);\n\tBook b2 = new Book("Holes", 233);\n\tBook b3 = new Book("Hatchet", 195);\n\n\tfiction.add(b1);\n\tif(fiction.add(b1) == true)\n\t{\n\t\tSystem.out.println("true");\n\t}\n\telse{\n\t\tSystem.out.println("false");\n\t}\n\n\tfiction.add(b2);\n\tif(fiction.add(b2) == true)\n\t{\n\t\tSystem.out.println("true");\n\t}\n\telse{\n\t\tSystem.out.println("false");\n\t}\n\n\tfiction.add(b3);\n\tif(fiction.add(b3) == true)\n\t{\n\t\tSystem.out.println("true");\n\t}\n\telse{\n\t\tSystem.out.println("false");\n\t}\n\n\tSystem.out.println(fiction.getName());\n\tSystem.out.println(fiction.printTitlesOverPages(200));\n\n\tfor(int i = 0; i < 10; i++)\n\t{\n\t\tBook r = new Book("random", Randomizer.nextInt(80,400));\n\t\tfiction.add(r)\n\t\tif(fiction.add(r) == true)\n\t\t{\n\t\t\tSystem.out.println("true");\n\t\t}\n\t\telse{\n\t\t\tSystem.out.println("false")\n\t\t}\n\t}\n}',
    acceptedScoreRange: { min: 6, max: 8 },
    rationale:
      'Six criteria are cleanly met. Two fail outright: `science` is never usable (typed `Libary`) and the random books are added to `fiction` instead. Two are partial — add is called twice per book, and a void print is wrapped in println. Six met sets the floor; the failures cost one mark each and are not charged twice. Teacher adjudicated the equivalent real response at 6-8 against a recorded 10 of 10 and a grader score of 4.',
  },
  {
    id: 'calibrated-rubric-floor-seven-met',
    label: 'Seven of ten criteria met, one clear failure',
    ...calibratedLibrary,
    provenance: 'calibrated',
    responseText:
      'public void run()\n{\n\tLibrary fiction = new Library("fiction", 2);\n\tBook b1 = new Book("Dune", 412);\n\tBook b2 = new Book("Holes", 233);\n\tBook b3 = new Book("Hatchet", 195);\n\tSystem.out.println(b1.getTitle() + fiction.add(b1));\n\tSystem.out.println(b2.getTitle() + fiction.add(b2));\n\tSystem.out.println(b3.getTitle() + fiction.add(b3));\n\tSystem.out.println(fiction.getName() + Library.fictionTitlesOverPages());\n\tLibrary science = new Library("science");\n\tfor (int i = 0; i < 10; i++)\n\t{\n\t\tint pages = Randomizer.nextInt(80, 400);\n\t\tSystem.out.println(book.getTitle() + science.add(book) + pages);\n\t}\n}',
    acceptedScoreRange: { min: 7, max: 8 },
    rationale:
      'Seven criteria are cleanly met, including single add calls printing the real return value and a correctly constructed `science`. One fails: no Book is created inside the loop, so `book` is undeclared. One is partial — the over-200-pages output calls an invented static. Seven met sets the floor. Teacher adjudicated the equivalent real response at 7-8 against a recorded 10 of 10 and a grader score of 4.',
  },
  {
    id: 'calibrated-near-perfect-typos',
    label: 'Matches the sample solution apart from two typos',
    ...calibratedLibrary,
    provenance: 'calibrated',
    responseText:
      'public void run() {\n\tLibrary fiction = new Library("fiction", 2);\n\tBook b1 = new Book("Dune", 412);\n\tBook b2 = new Book("Holes". 233);\n\tBook b3 = new Book("Hatchet", 195);\n\n\tSystem.out.println(fiction.add(b1));\n\tSystem.out.println(fiction.add(b2));\n\tSystem.out.println(fiction.add(b3));\n\n\tSystem.out.println(fiction.getName());\n\tfiction.printTitlesOverPages(200);\n\n\tLibrary science = new Library("science");\n\tfor(int i = 0; i < 10; i++)\n\t{\n\t\tBook b = new Book("Book" + i, Randomizer.nextInt(80,400);\n\t\tSystem.out.println(science.add(b));\n\t}\n}',
    acceptedScoreRange: { min: 9, max: 10 },
    rationale:
      'Reproduces the sample solution almost line for line. The only defects are a period typed for a comma and one unclosed parenthesis — both pure transcription. Every criterion is satisfied in substance. The real equivalent lost 3 of 10 marks to exactly these two characters before calibration.',
  },
  {
    id: 'calibrated-conceptual-failure-stays-low',
    label: 'Inheritance written backwards — must not drift upward',
    ...calibratedVehicleInheritance,
    provenance: 'calibrated',
    responseText:
      'public class Vehicle\n{\n\tprivate static int numberOfVehicles = 0;\n\tprivate double price;\n\n\tpublic Vehicle(double p)\n\t{\n\t\tprice = p;\n\t\tnumberOfVehicles++;\n\t}\n\n\tpublic double tax(double price)\n\t{\n\t\treturn price * 0.1;\n\t}\n}\n\npublic class Vehicle extends Truck\n{\n\tprivate int capacity;\n\n\tpublic Vehicle(int cap)\n\t{\n\t\tsuper(price);\n\t\tcapacity = cap;\n\t}\n\n\tpublic double tax(double price)\n\t{\n\t\treturn price * 0.13;\n\t}\n}',
    acceptedScoreRange: { min: 3, max: 6 },
    rationale:
      'The guard fixture. Inheritance runs the wrong way — the subclass is declared `Vehicle extends Truck` and reuses the superclass name — and the class variable is private where the key requires public. These are conceptual failures, not transcription, and the score must stay low. If a future leniency rule lifts this fixture out of range, that rule has become a blanket softener rather than a correction.',
  },
]

export const TEST_AI_GOLD_SET_SUPPORTED_PROMPT_PROFILES: TestOpenResponsePromptProfile[] = [
  'manual',
  'bulk',
]
