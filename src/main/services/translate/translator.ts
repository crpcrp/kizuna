export interface Translator {
  /** Translates `text` (default ja→en). Rejects with a sanitized Error on
   * provider failure or malformed payload; resolves '' for blank input. */
  translate(
    text: string,
    sourceLang?: string,
    targetLang?: string,
    signal?: AbortSignal
  ): Promise<string>
}
