declare module 'seek-bzip' {
  /** Decompresses a whole bzip2 file; `multistream` also reads concatenated streams. */
  export function decode(input: Uint8Array, output?: undefined, multistream?: boolean): Uint8Array
}
