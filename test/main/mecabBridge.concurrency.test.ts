import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '@src/main/mecabBridge'
import { deferred } from '@test/harness/deferred'

describe('mapWithConcurrency', () => {
  it('never starts more tasks than the concurrency limit', async () => {
    const tasks = [deferred<number>(), deferred<number>(), deferred<number>()]
    let active = 0
    let maximumActive = 0

    const batch = mapWithConcurrency(tasks, 2, (task) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      return task.promise.finally(() => {
        active -= 1
      })
    })
    await Promise.resolve()

    expect(maximumActive).toBe(2)
    tasks[0].resolve(0)
    await Promise.resolve()
    expect(maximumActive).toBe(2)
    tasks[1].resolve(1)
    tasks[2].resolve(2)
    await expect(batch).resolves.toEqual([0, 1, 2])
  })

  it('returns results in input order when tasks finish out of order', async () => {
    const tasks = [deferred<string>(), deferred<string>(), deferred<string>()]
    const batch = mapWithConcurrency(tasks, 2, (task) => task.promise)
    await Promise.resolve()

    tasks[1].resolve('second')
    await Promise.resolve()
    tasks[2].resolve('third')
    tasks[0].resolve('first')

    await expect(batch).resolves.toEqual(['first', 'second', 'third'])
  })

  it('returns immediately without scheduling work for empty input', async () => {
    let scheduled = 0

    await expect(
      mapWithConcurrency<string, string>([], 2, async (value) => {
        scheduled += 1
        return value
      })
    ).resolves.toEqual([])

    expect(scheduled).toBe(0)
  })

  it('rejects with the original error and does not schedule more tasks', async () => {
    const tasks = [deferred<number>(), deferred<number>(), deferred<number>()]
    const started: number[] = []
    const expectedError = new Error('MeCab failed')
    const batch = mapWithConcurrency(tasks, 2, (task, index) => {
      started.push(index)
      return task.promise
    })
    await Promise.resolve()

    tasks[0].reject(expectedError)
    await expect(batch).rejects.toBe(expectedError)
    expect(started).toEqual([0, 1])

    tasks[1].resolve(1)
  })
})
