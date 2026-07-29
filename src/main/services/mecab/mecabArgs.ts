// Phase 2 · Task A3 — MeCab argv builder. Pure, synchronous, no I/O.

/**
 * Builds the argv for running MeCab against a given dictionary directory,
 * e.g.:
 *   mecab -d <dicdir>
 * MeCab's default output (one node per line, terminated by `EOS`) is what
 * `parseMecab` expects, so no output-format flags are added.
 */
export function buildMecabArgs(dicdir: string): string[] {
  return ['-d', dicdir]
}
