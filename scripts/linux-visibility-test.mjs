#!/usr/bin/env node

/**
 * Real-pixel Linux/X11 acceptance test for Kizuna.
 *
 * This is deliberately separate from the hermetic Vitest suite: it launches
 * Electron and mpv on a private Xvfb display, captures the composed desktop,
 * and fails if the video/UI are black, frozen, missing, unstable, or no longer
 * arranged as one logical window pair.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screenWidth = 1600
const screenHeight = 900
const temp = mkdtempSync(join(tmpdir(), 'kizuna-linux-visibility-'))
const children = new Set()
const resultPath = join(temp, 'result.json')
let cdp

function fail(message, details = {}) {
  const result = { ok: false, message, ...details }
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  throw new Error(message)
}

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024
  })
  if (result.status !== 0) {
    fail(`${name} failed`, {
      command: [name, ...args],
      status: result.status,
      stderr: String(result.stderr).slice(-4000)
    })
  }
  return result.stdout
}

function start(name, args, options = {}) {
  const child = spawn(name, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

async function waitForTcp(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const connected = await new Promise((done) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        done(true)
      })
      socket.once('error', () => done(false))
    })
    if (connected) return
    await wait(100)
  }
  fail(`Xvfb did not listen on TCP port ${port}`)
}

async function waitFor(predicate, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await predicate()
      if (last) return last
    } catch (error) {
      last = String(error)
    }
    await wait(150)
  }
  fail(`Timed out waiting for ${description}`, { last })
}

function parseWindowTree(tree) {
  const topLevels = []
  let mpvChildren = 0
  for (const line of tree.split(/\r?\n/)) {
    const match = line.match(/^\s+(0x[\da-f]+) "Kizuna": .*?\s+(\d+)x(\d+)\+(-?\d+)\+(-?\d+)\s+/i)
    if (match && line.match(/^\s{5}\S/)) {
      topLevels.push({
        id: match[1],
        width: Number(match[2]),
        height: Number(match[3]),
        x: Number(match[4]),
        y: Number(match[5])
      })
    }
    if (line.includes('("x11" "mpv")')) mpvChildren += 1
  }
  return { topLevels, mpvChildren }
}

function captureDesktop(displayEnv) {
  return command(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'x11grab',
      '-video_size',
      `${screenWidth}x${screenHeight}`,
      '-i',
      `${displayEnv.DISPLAY}.0`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1'
    ],
    { env: displayEnv, encoding: null }
  )
}

function pixelMetrics(frame, bounds) {
  let black = 0
  let saturated = 0
  let count = 0
  const left = Math.max(0, bounds.x + 20)
  const right = Math.min(screenWidth, bounds.x + bounds.width - 20)
  const top = Math.max(0, bounds.y + 80)
  const bottom = Math.min(screenHeight, bounds.y + bounds.height - 120)
  for (let y = top; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const offset = (y * screenWidth + x) * 3
      const r = frame[offset]
      const g = frame[offset + 1]
      const b = frame[offset + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max < 18) black += 1
      if (max - min > 90 && max > 120) saturated += 1
      count += 1
    }
  }
  return { blackRatio: black / count, saturatedRatio: saturated / count }
}

function frameDifference(left, right, bounds, inset = { top: 80, bottom: 120 }) {
  let changed = 0
  let total = 0
  let totalDelta = 0
  const x0 = Math.max(0, bounds.x + 20)
  const x1 = Math.min(screenWidth, bounds.x + bounds.width - 20)
  const y0 = Math.max(0, bounds.y + inset.top)
  const y1 = Math.min(screenHeight, bounds.y + bounds.height - inset.bottom)
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const offset = (y * screenWidth + x) * 3
      const delta =
        Math.abs(left[offset] - right[offset]) +
        Math.abs(left[offset + 1] - right[offset + 1]) +
        Math.abs(left[offset + 2] - right[offset + 2])
      if (delta > 24) changed += 1
      totalDelta += delta
      total += 1
    }
  }
  return { changedRatio: changed / total, meanDelta: totalDelta / total / 3 }
}

function chromeDifference(baseline, modal, bounds) {
  // Opening Settings creates a full-window modal/backdrop. A large central
  // pixel delta proves the dynamic region became visible over the video.
  return frameDifference(baseline, modal, bounds, { top: 100, bottom: 100 })
}

function controlPixelMetrics(frame, overlay, rect) {
  let hot = 0
  let brightNeutral = 0
  let count = 0
  const left = Math.max(0, overlay.x + Math.floor(rect.x))
  const right = Math.min(screenWidth, overlay.x + Math.ceil(rect.x + rect.width))
  const top = Math.max(0, overlay.y + Math.floor(rect.y))
  const bottom = Math.min(screenHeight, overlay.y + Math.ceil(rect.y + rect.height))
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * screenWidth + x) * 3
      const r = frame[offset]
      const g = frame[offset + 1]
      const b = frame[offset + 2]
      if (r > 160 && r - g > 35 && r - b > 20) hot += 1
      if (Math.max(r, g, b) - Math.min(r, g, b) < 28 && Math.min(r, g, b) > 175) {
        brightNeutral += 1
      }
      count += 1
    }
  }
  return { hotRatio: hot / count, brightNeutralRatio: brightNeutral / count }
}

async function connectCdp(port) {
  const pages = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`)
    const json = await response.json()
    return json.find((page) => page.type === 'page' && page.webSocketDebuggerUrl)
  }, 'the renderer debugging endpoint')
  const socket = new WebSocket(pages.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const callbacks = pending.get(message.id)
    if (!callbacks) return
    pending.delete(message.id)
    if (message.error) callbacks.reject(new Error(message.error.message))
    else callbacks.resolve(message.result)
  })
  return {
    evaluate(expression) {
      const messageId = ++id
      socket.send(
        JSON.stringify({
          id: messageId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
      return new Promise((resolveResult, reject) => {
        pending.set(messageId, { resolve: resolveResult, reject })
      })
    },
    close() {
      socket.close()
    }
  }
}

async function main() {
  if (process.platform !== 'linux') fail('This acceptance test must run on Linux.')
  for (const executable of ['Xvfb', 'xcompmgr', 'xauth', 'xwininfo', 'ffmpeg', 'mpv']) {
    const found = spawnSync('sh', ['-lc', `command -v ${executable}`], { encoding: 'utf8' })
    if (found.status !== 0) fail(`Missing required Linux test dependency: ${executable}`)
  }

  const electron = join(root, 'node_modules', 'electron', 'dist', 'electron')
  if (!existsSync(electron))
    fail('Linux Electron is not installed; run npm install on Linux first.')
  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    fail('The app is not built; run npm run build before this acceptance test.')
  }

  if (process.env.WSL_INTEROP && !existsSync('/mnt/shared_memory')) {
    console.warn(
      '[visibility] WSLg shared memory is missing; the Windows-facing WSLg desktop is known to be in COPY MODE. The isolated X11 proof will still run.'
    )
  }

  const displayNumber = 120 + Math.floor(Math.random() * 60)
  const display = `localhost:${displayNumber}`
  const auth = join(temp, 'Xauthority')
  const cookie = randomBytes(16).toString('hex')
  command('xauth', ['-f', auth, 'add', display, 'MIT-MAGIC-COOKIE-1', cookie])
  const displayEnv = { ...process.env, DISPLAY: display, XAUTHORITY: auth }
  start(
    'Xvfb',
    [
      `:${displayNumber}`,
      '-screen',
      '0',
      `${screenWidth}x${screenHeight}x24`,
      '+extension',
      'COMPOSITE',
      '+extension',
      'RENDER',
      '-nolisten',
      'unix',
      '-listen',
      'tcp',
      '-auth',
      auth
    ],
    { env: displayEnv }
  )
  await waitForTcp(6000 + displayNumber)
  start('xcompmgr', ['-n'], { env: displayEnv })
  await wait(300)

  const video = join(temp, 'visibility-test.mp4')
  command('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30:duration=10',
    '-c:v',
    'mpeg4',
    '-q:v',
    '2',
    '-pix_fmt',
    'yuv420p',
    video
  ])

  const configRoot = join(temp, 'config')
  const appData = join(configRoot, 'Kizuna')
  command('mkdir', ['-p', appData])
  writeFileSync(
    join(appData, 'settings.json'),
    `${JSON.stringify({ player: { appearance: { theme: 'dark' } } })}\n`
  )
  const debugPort = 9200 + Math.floor(Math.random() * 500)
  const appEnv = {
    ...displayEnv,
    XDG_CONFIG_HOME: configRoot,
    ELECTRON_RUN_AS_NODE: ''
  }
  const app = start(electron, [`--remote-debugging-port=${debugPort}`, '.', video], {
    cwd: root,
    env: appEnv
  })
  let appLog = ''
  app.stdout.on('data', (chunk) => (appLog += chunk))
  app.stderr.on('data', (chunk) => (appLog += chunk))

  const initialTree = await waitFor(() => {
    const tree = command('xwininfo', ['-root', '-tree'], { env: displayEnv })
    const parsed = parseWindowTree(tree)
    return parsed.topLevels.length === 2 && parsed.mpvChildren === 1 ? { tree, parsed } : null
  }, 'two coordinated Kizuna windows and one embedded mpv child')
  const overlay = initialTree.parsed.topLevels.find(
    (window) => window.width === 1280 && window.height === 720
  )
  if (!overlay) fail('Could not identify the 1280x720 renderer overlay.', initialTree.parsed)

  cdp = await connectCdp(debugPort)
  await wait(700)
  const movingA = captureDesktop(displayEnv)
  await wait(700)
  const movingB = captureDesktop(displayEnv)
  const moving = frameDifference(movingA, movingB, overlay)
  if (moving.changedRatio < 0.002) fail('Video pixels are frozen.', { moving })

  const visible = pixelMetrics(movingB, overlay)
  if (visible.blackRatio > 0.75)
    fail('The composed video area is predominantly black.', { visible })
  if (visible.saturatedRatio < 0.2)
    fail('The deterministic color video is not visible.', { visible })

  const controlRectsResult = await cdp.evaluate(`(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect()
      return value && { x: value.x, y: value.y, width: value.width, height: value.height }
    }
    return { settings: rect('#menu-settings'), play: rect('#play-pause') }
  })()`)
  const controlRects = controlRectsResult.result?.value
  if (!controlRects?.settings || !controlRects?.play) {
    fail('Could not locate the normal Kizuna controls in the renderer.', { controlRects })
  }
  const controls = {
    settings: controlPixelMetrics(movingB, overlay, controlRects.settings),
    play: controlPixelMetrics(movingB, overlay, controlRects.play)
  }
  if (controls.settings.brightNeutralRatio < 0.01) {
    fail('The Settings menu label is not visible in the composed desktop.', { controls })
  }
  if (controls.play.hotRatio < 0.15) {
    fail('The primary play control is not visible in the composed desktop.', { controls })
  }

  await cdp.evaluate("document.querySelector('#menu-settings')?.click()")
  await wait(500)
  const modalFrame = captureDesktop(displayEnv)
  const modal = chromeDifference(movingB, modalFrame, overlay)
  if (modal.changedRatio < 0.08 || modal.meanDelta < 12) {
    fail('The Settings modal did not become visibly composed over the video.', { modal })
  }
  await cdp.evaluate("document.querySelector('#options-menu button[aria-label=Close]')?.click()")

  // The ten-second source is now at keep-open EOF. Stable desktop captures
  // must remain virtually identical: alternating black/full frames or window
  // duplication is treated as flicker.
  await wait(9000)
  const stableFrames = []
  const geometry = []
  for (let index = 0; index < 4; index += 1) {
    const tree = command('xwininfo', ['-root', '-tree'], { env: displayEnv })
    const parsed = parseWindowTree(tree)
    geometry.push(parsed)
    if (parsed.topLevels.length !== 2 || parsed.mpvChildren !== 1) {
      fail('The logical Linux window pair duplicated or lost a layer.', { geometry })
    }
    stableFrames.push(captureDesktop(displayEnv))
    await wait(250)
  }
  const stability = stableFrames
    .slice(1)
    .map((frame, index) =>
      frameDifference(stableFrames[index], frame, overlay, { top: 0, bottom: 0 })
    )
  if (stability.some((sample) => sample.changedRatio > 0.01)) {
    fail('The composed window flickers after playback becomes static.', { stability })
  }
  const geometrySignatures = geometry.map((sample) => JSON.stringify(sample.topLevels))
  if (new Set(geometrySignatures).size !== 1) {
    fail('The coordinated host/overlay geometry is unstable.', { geometry })
  }

  // Negative control: restore the old full rectangular overlay for one final
  // capture. On this same healthy X server that architecture hides or heavily
  // desaturates the video behind the transparent surface; the analyzer must reject it. This
  // proves the gate distinguishes the historical failure from the fixed app
  // instead of merely accepting any running Electron process.
  await cdp.evaluate(
    `window.kizuna.windowControls.setShape([{ x: 0, y: 0, width: ${overlay.width}, height: ${overlay.height} }])`
  )
  await wait(300)
  const negativeControl = pixelMetrics(captureDesktop(displayEnv), overlay)
  if (negativeControl.blackRatio <= 0.75 && negativeControl.saturatedRatio >= 0.2) {
    fail('The full-overlay negative control was not rejected by the pixel oracle.', {
      negativeControl
    })
  }

  const result = {
    ok: true,
    message: 'Kizuna UI and moving video are visibly composed as one stable Linux/X11 surface.',
    display,
    overlay,
    moving,
    visible,
    controls,
    modal,
    stability,
    negativeControl,
    windowTree: initialTree.parsed,
    wslgCopyMode: Boolean(process.env.WSL_INTEROP && !existsSync('/mnt/shared_memory'))
  }
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
}

try {
  await main()
} catch (error) {
  console.error(`[visibility] ${error instanceof Error ? error.message : String(error)}`)
  if (existsSync(resultPath)) console.error(readFileSync(resultPath, 'utf8'))
  process.exitCode = 1
} finally {
  cdp?.close()
  for (const child of [...children].reverse()) {
    if (!child.killed) child.kill('SIGTERM')
  }
  await wait(300)
  rmSync(temp, { recursive: true, force: true })
}
