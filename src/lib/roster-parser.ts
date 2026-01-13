/**
 * Roster Parser Utility
 *
 * Parses student roster data from text input.
 * Supports multiple formats:
 * - Space-separated: "First Last email@example.com"
 * - Comma-separated: "First, Last, email@example.com"
 * - Tab-separated: "First\tLast\temail@example.com"
 * - With optional student number as 4th field
 */

export interface ParsedStudent {
  firstName: string
  lastName: string
  email: string
  studentNumber?: string
  counselorEmail?: string
}

export interface ParseError {
  line: number
  error: string
  raw: string
}

export interface ParseResult {
  students: ParsedStudent[]
  errors: ParseError[]
}

// Basic email regex - checks for something@something.something
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Detects the separator used in a line of text
 * Priority: tab > comma > multiple spaces
 */
function detectSeparator(line: string): string {
  if (line.includes('\t')) return '\t'
  if (line.includes(',')) return ','
  return ' ' // space-separated (default)
}

/**
 * Splits a line by the detected separator and cleans up tokens
 */
function tokenizeLine(line: string): string[] {
  const separator = detectSeparator(line)

  let tokens: string[]
  if (separator === ' ') {
    // For space-separated, split by multiple spaces and filter empty
    tokens = line.split(/\s+/).filter(t => t.length > 0)
  } else {
    // For tab or comma, split and trim each token
    tokens = line.split(separator).map(t => t.trim()).filter(t => t.length > 0)
  }

  return tokens
}

/**
 * Finds the email token in an array of tokens
 * Returns email if valid, or info about invalid email if found
 */
function findEmailToken(tokens: string[]): {
  email: string;
  index: number;
  valid: boolean
} | null {
  // First, look for a valid email
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (EMAIL_REGEX.test(token)) {
      return { email: token.toLowerCase(), index: i, valid: true }
    }
  }

  // If no valid email, check for something that looks like it might be an email (contains @)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.includes('@')) {
      return { email: token.toLowerCase(), index: i, valid: false }
    }
  }

  return null
}

/**
 * Parses a single line of roster data
 */
function parseLine(line: string, lineNumber: number): { student: ParsedStudent | null; error: ParseError | null } {
  const tokens = tokenizeLine(line)

  // Need at least 2 tokens to check if we have first and last name
  if (tokens.length < 2) {
    return {
      student: null,
      error: {
        line: lineNumber,
        error: 'Line must contain at least first and last name and email',
        raw: line,
      },
    }
  }

  // Need at least 3 tokens: firstName, lastName, email
  if (tokens.length < 3) {
    return {
      student: null,
      error: {
        line: lineNumber,
        error: 'Line must contain both first and last name and email',
        raw: line,
      },
    }
  }

  // Assume format is: firstName lastName email [studentNumber] [counselorEmail]
  const firstName = tokens[0]
  const lastName = tokens[1]
  const emailCandidate = tokens[2]
  const studentNumber = tokens[3] || undefined
  const counselorEmailCandidate = tokens[4] || undefined

  // Validate email format
  if (!EMAIL_REGEX.test(emailCandidate)) {
    return {
      student: null,
      error: {
        line: lineNumber,
        error: 'Invalid email format',
        raw: line,
      },
    }
  }

  const email = emailCandidate.toLowerCase()

  const student: ParsedStudent = {
    firstName,
    lastName,
    email,
  }

  if (studentNumber) {
    student.studentNumber = studentNumber
  }

  // Validate counselor email if provided
  if (counselorEmailCandidate) {
    if (EMAIL_REGEX.test(counselorEmailCandidate)) {
      student.counselorEmail = counselorEmailCandidate.toLowerCase()
    }
    // If invalid, we silently ignore it (don't fail the whole line)
  }

  return { student, error: null }
}

/**
 * Parses roster input text into an array of students
 *
 * @param input - Multi-line text input with student data
 * @returns ParseResult with students array and errors array
 */
export function parseRosterInput(input: string): ParseResult {
  const students: ParsedStudent[] = []
  const errors: ParseError[] = []

  // Split by newlines and filter empty lines
  const lines = input
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const { student, error } = parseLine(line, lineNumber)

    if (student) {
      students.push(student)
    }

    if (error) {
      errors.push(error)
    }
  })

  return { students, errors }
}
