import { describe, it, expect } from 'vitest'
import {
  buildFfmpegExtractArgs,
  createFfmpegExec,
  extractSubtitleTrack,
  FFMPEG_TIMEOUT_MS
} from '@src/main/media/ffmpeg'
import type { FfmpegExecFile } from '@src/main/media/ffmpeg'
import { fakeFfmpegSuccess, fakeFfmpegFailure } from '@test/harness/fakeFfmpeg'

describe('buildFfmpegExtractArgs', () => {
  it('maps the absolute stream index and forces the codec matching the .srt output extension', () => {
    const args = buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 4, 'C:\\tmp\\out.srt')

    expect(args).toEqual([
      '-v',
      'error',
      '-y',
      '-i',
      'C:\\videos\\episode.mkv',
      '-map',
      '0:4',
      '-c:s',
      'srt',
      'C:\\tmp\\out.srt'
    ])
  })

  it('forces the ass codec for a .ass output path', () => {
    const args = buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 3, 'C:\\tmp\\out.ass')

    expect(args).toContain('-c:s')
    expect(args[args.indexOf('-c:s') + 1]).toBe('ass')
    expect(args).toContain('C:\\tmp\\out.ass')
  })

  it('falls back to copy for an unrecognized output extension', () => {
    const args = buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 3, 'C:\\tmp\\out.sub')

    expect(args[args.indexOf('-c:s') + 1]).toBe('copy')
  })
})

describe('createFfmpegExec', () => {
  it('sets the output cap and a terminating hard deadline on the child process', async () => {
    const execFileImpl = ((file, args, options, callback) => {
      expect(file).toBe('/bin/ffmpeg')
      expect(args).toEqual(['-v', 'error', '-i', 'episode.mkv'])
      expect(options).toEqual({
        maxBuffer: 10 * 1024 * 1024,
        timeout: FFMPEG_TIMEOUT_MS,
        killSignal: 'SIGTERM'
      })
      callback(null)
      return undefined
    }) as FfmpegExecFile

    await expect(
      createFfmpegExec(execFileImpl)('/bin/ffmpeg', ['-v', 'error', '-i', 'episode.mkv'])
    ).resolves.toBeUndefined()
  })

  it('rejects a timed-out child exactly once', async () => {
    const timeoutError = Object.assign(new Error('ffmpeg timed out'), {
      killed: true,
      signal: 'SIGTERM'
    })
    const execFileImpl = ((_file, _args, _options, callback) => {
      callback(timeoutError)
      callback(timeoutError)
      return undefined
    }) as FfmpegExecFile
    const exec = createFfmpegExec(execFileImpl)
    let rejectionCount = 0

    await exec('/bin/ffmpeg', ['-i', 'episode.mkv']).catch((error: unknown) => {
      rejectionCount += 1
      expect(error).toBe(timeoutError)
    })

    expect(rejectionCount).toBe(1)
  })

  it('preserves the non-zero exit rejection', async () => {
    const exitError = Object.assign(new Error('ffmpeg exited with code 1'), { code: 1 })
    const execFileImpl = ((_file, _args, _options, callback) => {
      callback(exitError)
      return undefined
    }) as FfmpegExecFile

    await expect(createFfmpegExec(execFileImpl)('/bin/ffmpeg', ['-i', 'episode.mkv'])).rejects.toBe(
      exitError
    )
  })
})

describe('extractSubtitleTrack', () => {
  it('resolves with outputPath and calls exec with buildFfmpegExtractArgs', async () => {
    const fake = fakeFfmpegSuccess()

    const result = await extractSubtitleTrack(
      'C:\\bin\\ffmpeg.exe',
      'C:\\videos\\episode.mkv',
      4,
      'C:\\tmp\\out.srt',
      fake.exec
    )

    expect(result).toBe('C:\\tmp\\out.srt')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].ffmpegPath).toBe('C:\\bin\\ffmpeg.exe')
    expect(fake.calls[0].args).toEqual(
      buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 4, 'C:\\tmp\\out.srt')
    )
  })

  it('propagates rejection from the injected exec unchanged', async () => {
    const fake = fakeFfmpegFailure(new Error('ffmpeg exited with code 1'))

    await expect(
      extractSubtitleTrack(
        'ffmpeg.exe',
        'C:\\videos\\episode.mkv',
        3,
        'C:\\tmp\\out.ass',
        fake.exec
      )
    ).rejects.toThrow('ffmpeg exited with code 1')
  })
})
