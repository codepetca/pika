import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const WORKTREE = process.cwd()
const SCRIPT_PATH = resolve(WORKTREE, 'docs', 'marketing', 'voiceover-60s.txt')
const AUDIO_PATH = resolve(WORKTREE, 'artifacts', 'marketing', 'audio', 'pika-voiceover-60s.aiff')
const OUT_DIR = resolve(WORKTREE, 'artifacts', 'marketing', 'captions')
const OUT_FILE = resolve(OUT_DIR, 'pika-voiceover-60s.srt')
const DEFAULT_DURATION_SECONDS = Number(process.env.MARKETING_CAPTIONS_DURATION_SECONDS || 60)

function readScriptLines() {
  const raw = readFileSync(SCRIPT_PATH, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function probeAudioDurationSeconds() {
  if (!existsSync(AUDIO_PATH)) return DEFAULT_DURATION_SECONDS

  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 \"${AUDIO_PATH}\"`,
      { encoding: 'utf8' }
    ).trim()

    const parsed = Number(output)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DURATION_SECONDS
    return parsed
  } catch {
    return DEFAULT_DURATION_SECONDS
  }
}

function toTimestamp(totalSeconds: number) {
  const clamped = Math.max(totalSeconds, 0)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const seconds = Math.floor(clamped % 60)
  const milliseconds = Math.floor((clamped - Math.floor(clamped)) * 1000)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function buildSrt(lines: string[], totalDurationSeconds: number) {
  const minCueDuration = 1.4
  const wordsPerLine = lines.map((line) => line.split(/\s+/).filter(Boolean).length)
  const totalWords = wordsPerLine.reduce((sum, count) => sum + count, 0)

  const cues: string[] = []
  let cursor = 0

  lines.forEach((line, index) => {
    const weight = totalWords > 0 ? wordsPerLine[index] / totalWords : 1 / lines.length
    const weightedDuration = Math.max(totalDurationSeconds * weight, minCueDuration)

    const remainingLines = lines.length - index - 1
    const maxAllowed = totalDurationSeconds - cursor - remainingLines * minCueDuration
    const duration = Math.max(minCueDuration, Math.min(weightedDuration, maxAllowed))

    const start = cursor
    const end = Math.min(cursor + duration, totalDurationSeconds)
    cursor = end

    cues.push(`${index + 1}`)
    cues.push(`${toTimestamp(start)} --> ${toTimestamp(end)}`)
    cues.push(line)
    cues.push('')
  })

  return cues.join('\n')
}

function run() {
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`Voiceover script not found: ${SCRIPT_PATH}`)
  }

  const lines = readScriptLines()
  if (lines.length === 0) {
    throw new Error('Voiceover script is empty')
  }

  const durationSeconds = probeAudioDurationSeconds()
  const srt = buildSrt(lines, durationSeconds)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, srt, 'utf8')

  console.log(`Generated: ${OUT_FILE}`)
  console.log(`Caption duration target: ${durationSeconds.toFixed(2)}s`)
}

run()
