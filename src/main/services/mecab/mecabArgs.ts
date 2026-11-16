// Keep the default node-per-line output with EOS; the parser depends on that format.
export function buildMecabArgs(dicdir: string): string[] {
  return ['-d', dicdir]
}
