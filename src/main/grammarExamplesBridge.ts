import { GRAMMAR_EXAMPLES_CHANNELS as C } from '../shared/ipcChannels'
import { isNonNegativeSafeInteger, isPositiveSafeInteger, isString } from '../shared/guards'
import { tatoebaSentenceUrl } from '../shared/grammarExamples'
import type { IpcMainHandleLike } from './ipc'
import { expect } from './ipcValidation'
import type { GrammarExamplesService } from './services/grammarExamples/service'

export interface GrammarExamplesBridgeDeps {
  send: (channel: string, value: unknown) => void
  openExternal: (url: string) => Promise<void>
}

export function registerGrammarExamplesBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: GrammarExamplesService,
  deps: GrammarExamplesBridgeDeps
): void {
  const patternArg = expect(isString, C.lookup)
  const lemmaArg = expect(isString, C.lookup)
  const offsetArg = expect(isNonNegativeSafeInteger, C.lookup)
  const limitArg = expect(isPositiveSafeInteger, C.lookup)
  ipc.handle(C.lookup, (_e, patternKey, lemma, offset, limit) =>
    service.lookup(patternArg(patternKey), lemmaArg(lemma), offsetArg(offset), limitArg(limit))
  )
  ipc.handle(C.status, () => service.status())
  ipc.handle(C.downloadSize, () => service.downloadSize())
  ipc.handle(C.download, () => service.download())
  ipc.handle(C.rebuild, () => service.rebuild())
  ipc.handle(C.cancel, () => service.cancel())
  ipc.handle(C.remove, () => service.remove())
  const idArg = expect(isPositiveSafeInteger, C.openSentence)
  ipc.handle(C.openSentence, (_e, id) => deps.openExternal(tatoebaSentenceUrl(idArg(id))))
  service.subscribe((status) => deps.send(C.statusChanged, status))
}
