// Test harness — fake mpv JSON IPC server: no live binaries.
//
// A net.Server on a unique per-instance named pipe that parses newline-JSON
// commands and lets tests script replies and push events. All mpv IPC tests
// go through this instead of mpv.exe.

import { createServer, type Server, type Socket } from 'node:net'

export interface ReceivedCommand {
  command: unknown[]
  request_id: number
}

/**
 * Handler for incoming commands. Return an object to reply immediately
 * (request_id is filled in for you), or nothing to stay silent so the test
 * can reply manually later (out-of-order scenarios).
 */
export type CommandHandler = (msg: ReceivedCommand) => Record<string, unknown> | undefined | void

let pipeCounter = 0

export class FakeMpvServer {
  readonly pipePath = `\\\\.\\pipe\\kizuna-fake-mpv-${process.pid}-${pipeCounter++}`
  readonly received: ReceivedCommand[] = []

  private server: Server | null = null
  private readonly sockets: Socket[] = []
  private buffer = ''
  /** Default: mpv-style success reply with no data. */
  private handler: CommandHandler = () => ({ error: 'success' })

  onCommand(handler: CommandHandler): void {
    this.handler = handler
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((sock) => {
        this.sockets.push(sock)
        sock.on('data', (chunk) => this.onData(chunk))
        sock.on('error', () => sock.destroy())
      })
      this.server.once('error', reject)
      this.server.listen(this.pipePath, () => resolve())
    })
  }

  /**
   * Resolves once a client socket is attached. The client's connect callback
   * can fire before the server's 'connection' event — await this before
   * pushing unsolicited events at a client that hasn't sent anything yet.
   */
  waitForConnection(): Promise<void> {
    if (this.sockets.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.server?.once('connection', () => resolve()))
  }

  /** Sends a scripted reply for a given request_id. */
  reply(request_id: number, fields: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify({ request_id, ...fields }) + '\n')
  }

  /** Pushes an mpv event (e.g. {event: 'property-change', id, name, data}). */
  pushEvent(event: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify(event) + '\n')
  }

  /** Writes raw bytes to every client — for partial-chunk framing tests. */
  sendRaw(text: string): void {
    for (const sock of this.sockets) {
      if (!sock.destroyed) sock.write(text)
    }
  }

  close(): Promise<void> {
    for (const sock of this.sockets) sock.destroy()
    this.sockets.length = 0
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
      this.server = null
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line) as ReceivedCommand
      this.received.push(msg)
      const response = this.handler(msg)
      if (response) this.reply(msg.request_id, response)
    }
  }
}
