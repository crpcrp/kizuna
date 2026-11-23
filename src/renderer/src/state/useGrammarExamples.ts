import { useEffect, useRef, useState } from 'react'
import type { GrammarExample, GrammarExamplePage } from '../../../shared/grammarExamples'
import type { KizunaApi } from '../../../shared/preloadApi'

const FIRST_PAGE = 2
const MORE_PAGE = 20

export type GrammarExamplesBridge = Pick<KizunaApi['grammarExamples'], 'lookup' | 'openSentence'>

export interface GrammarExamplesView {
  patternKey: string
  examples: GrammarExample[]
  total: number
  sameWordTotal: number
  loading: boolean
  loadMore(): void
  openSentence(tatoebaId: number): void
}

interface Loaded extends GrammarExamplePage {
  key: string
}

/** Examples for the popup's grammar pattern: two at first, then page by page. */
export function useGrammarExamples(
  bridge: GrammarExamplesBridge,
  patternKey: string,
  lemma: string
): GrammarExamplesView | undefined {
  const key = patternKey === '' ? '' : `${patternKey}\u0000${lemma}`
  const [loaded, setLoaded] = useState<Loaded | undefined>()
  const [loading, setLoading] = useState(false)
  const latestKey = useRef(key)

  useEffect(() => {
    latestKey.current = key
    if (key === '') return
    let active = true
    bridge.lookup(patternKey, lemma, 0, FIRST_PAGE).then(
      (page) => {
        if (active) setLoaded({ key, ...page })
      },
      () => {}
    )
    return () => {
      active = false
    }
  }, [bridge, key, patternKey, lemma])

  if (!loaded || loaded.key !== key || loaded.total === 0) return undefined
  return {
    patternKey,
    examples: loaded.examples,
    total: loaded.total,
    sameWordTotal: loaded.sameWordTotal,
    loading,
    loadMore: () => {
      if (loading) return
      setLoading(true)
      bridge
        .lookup(patternKey, lemma, loaded.examples.length, MORE_PAGE)
        .then((page) => {
          if (latestKey.current !== loaded.key) return
          setLoaded((previous) =>
            previous?.key === loaded.key
              ? { ...page, key: loaded.key, examples: [...previous.examples, ...page.examples] }
              : previous
          )
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    },
    openSentence: (tatoebaId) => void bridge.openSentence(tatoebaId).catch(() => {})
  }
}
