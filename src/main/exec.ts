import { execFile } from 'node:child_process'

/**
 * Runs `file` with `args` and resolves with its UTF-8 stdout. Stdout/stderr are
 * capped at 10 MiB; `timeoutMs` (0 = none) kills the child with SIGTERM.
 * `input`, when given, is written to stdin.
 */
export function runBounded(
  file: string,
  args: readonly string[],
  options: { timeoutMs?: number; input?: string; maxBuffer?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        encoding: 'utf-8',
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        timeout: options.timeoutMs ?? 0,
        killSignal: 'SIGTERM'
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
    if (options.input !== undefined) child.stdin?.end(options.input, 'utf-8')
  })
}
