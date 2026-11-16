# Main process

- Use the IPC and external-boundary procedures in [the codebase map](../../docs/codebase-map.md).
- Import `node:fs` directly and use fake timers with `vi.setSystemTime()` rather than injected clocks.
- Derive paths with an explicit platform through `pathApiFor`; see the codebase map for mechanics and test cases.
- Platform differences (Windows named pipe and single transparent window versus
  Linux socket endpoint and X11 host/overlay pair) live in `mpv/ipcEndpoint.ts`
  and `windowPair.ts` behind one interface. Do not spread `process.platform`
  branches into callers.
- Runtime binaries resolve only through `resourcePaths.ts`.
