# Licensing and Third-Party Notices

Kizuna's source code is licensed under
[GPL-3.0-or-later](../LICENSE). Bundled third-party software remains under its
own license.

## Packaged components

| Component | License | How it is used |
|---|---|---|
| mpv | GPL-3.0-or-later for the bundled build | Spawned video player |
| FFmpeg and ffprobe | GPL-3.0-or-later for the bundled build | Spawned media tools |
| MeCab | BSD-3-Clause option | Spawned tokenizer |
| IPADIC | NAIST-2003 | MeCab dictionary |
| yt-dlp | Unlicense | Optional spawned URL extractor |
| Electron | MIT, with Chromium and Node notices | Application runtime |
| Production npm dependencies | Package-specific permissive licenses | Packaged application code |

Exact versions, copyright statements, license files, and source references live
in [`third-party.json`](../third-party.json). The generated notice bundle is
the authoritative record for a particular build.

mpv, FFmpeg/ffprobe, MeCab, and yt-dlp run as separate processes; Kizuna does
not link their libraries into Electron. Revisit the licensing setup before
changing that boundary or adding a redistributed component.

## Generate notices

```powershell
npm run notices
```

This creates `build/notices/` containing:

- Kizuna's license;
- third-party notices and license texts;
- corresponding-source and build-recipe references.

`npm run dist` and `npm run dist:linux` generate the selected platform's bundle
before packaging it with the application. The release workflow also publishes
`kizuna-<version>-windows-x64-notices.zip` and
`kizuna-<version>-linux-x64-notices.tar.gz` as separate archives.

Notice generation fails when the vendor pin, packaged files, metadata, or
license texts do not agree. Repository tests check the same configuration so
drift is caught before release.

## Updating packaged software

When updating a pinned runtime component:

1. Publish the reviewed files, license texts, source reference, and build recipe
   to the [vendor mirror](https://github.com/crpcrp/kizuna-vendor).
2. Update `resources.lock.json` with the new mirror commit and file hashes.
3. Update `third-party.json` with the new version and licensing/source
   metadata.
4. Run `npm run resources`, `npm run notices`, and `npm test`.

For npm dependencies, keep `package.json` and `package-lock.json` in sync;
the notice generator reads production packages from the lockfile.

Do not distribute an installer if its generated notices or corresponding-source
references are incomplete.
