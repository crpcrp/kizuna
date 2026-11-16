// ASS Text is the final field and may contain commas; split only preceding fields.

import type { Cue } from '../../shared/cue'

const TIME_RE = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,2})$/

/** Converts an ASS timestamp (`H:MM:SS.cc`, centiseconds) to seconds. */
function timeToSeconds(raw: string): number | undefined {
  const match = raw.trim().match(TIME_RE)
  if (!match) return undefined
  const [, h, m, s, cs] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(cs.padEnd(2, '0')) / 100
}

function cleanText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N|\\n/g, '\n')
    .trim()
}

export function parseAss(content: string): Cue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const cues: Cue[] = []

  let inEvents = false
  let startIdx = -1
  let endIdx = -1
  let textIdx = -1

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    if (/^\[.*\]$/.test(line)) {
      inEvents = line.toLowerCase() === '[events]'
      if (!inEvents) {
        startIdx = -1
        endIdx = -1
        textIdx = -1
      }
      continue
    }

    if (!inEvents) continue

    if (/^Format:/i.test(line)) {
      const cols = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((c) => c.trim().toLowerCase())
      startIdx = cols.indexOf('start')
      endIdx = cols.indexOf('end')
      textIdx = cols.indexOf('text')
      continue
    }

    if (!/^Dialogue:/i.test(line)) continue
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue

    const fields = line.slice(line.indexOf(':') + 1).split(',')
    if (fields.length <= textIdx) continue

    const start = timeToSeconds(fields[startIdx])
    const end = timeToSeconds(fields[endIdx])
    if (start === undefined || end === undefined) continue

    const text = cleanText(fields.slice(textIdx).join(','))
    if (text.length === 0) continue

    cues.push({ start, end, text })
  }

  return cues
}
