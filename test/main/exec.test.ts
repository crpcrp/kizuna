import { describe, it, expect } from 'vitest'
import { runBounded } from '@src/main/exec'

// Spawns the current runtime as Node (`ELECTRON_RUN_AS_NODE` is inherited
// under `npm test`), so no external binary is needed.
const node = process.execPath

describe('runBounded', () => {
  it('pipes input to stdin and resolves with stdout', async () => {
    const script = 'process.stdin.pipe(process.stdout)'
    await expect(runBounded(node, ['-e', script], { input: '猫\n' })).resolves.toBe('猫\n')
  })

  it('kills the child at the deadline', async () => {
    await expect(
      runBounded(node, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 100 })
    ).rejects.toMatchObject({ killed: true, signal: 'SIGTERM' })
  })

  it('rejects output past the buffer cap', async () => {
    await expect(
      runBounded(node, ['-e', 'process.stdout.write("x".repeat(100))'], { maxBuffer: 10 })
    ).rejects.toMatchObject({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
  })

  it('rejects a non-zero exit', async () => {
    await expect(runBounded(node, ['-e', 'process.exit(3)'])).rejects.toMatchObject({ code: 3 })
  })
})
