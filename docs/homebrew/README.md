# Publishing to the webOS Homebrew Channel

Nothing here has been submitted. Publishing is a public action and the repository's rules require a person to do it.
Guide: https://www.webosbrew.org/develop/guides/publishing/how-to/ · Rules: https://www.webosbrew.org/develop/guides/publishing/rules/

## Rules that apply to you

- **AI disclosure.** The pull request template has an AI-use checkbox. Tick the one that is true. The rules forbid apps
  *produced primarily by AI without meaningful human development or review*, and you must be able to explain why the code is written the way it is.
- **Tested on a real TV.** You must name the TV model and webOS release (tested on an LG 43UP81006LR, webOS 6.5.3). An emulator or a browser does not count.
  Also test the oldest webOS release you claim to support, or set `requirements.webosRelease` in the YAML.
- **Own account only.** A service client must use the viewer's own account and must not work around the account or the DRM. This app signs in with the viewer's own Twitch account.
- **Icon and description should be your own work.** `docs/icon.png` is the generated icon from `tools/build.mjs`; replace it if you want something more personal.
- `main` packages need a public `sourceUrl` (this repository) and an identifiable licence: MIT, see `LICENSE`.

## Steps

1. `npm install && npm run package` creates `out/com.twitchlite.app_<version>_all.ipk`.
2. Generate the manifest from that exact IPK: `npm run manifest` (`tools/gen-manifest.mjs`) writes `out/com.twitchlite.app.manifest.json`. It is equivalent to the official tool (`webosbrew-toolbox-gen-manifest`, from https://github.com/webosbrew/dev-toolbox-cli, which is only shipped as a Linux .deb): same fields, and the SHA-256 and sizes of the exact IPK (`installedSize` is the sum of the file sizes in `data.tar.gz`; it reproduces the published 1.1.0 manifest).
   It records `id`, `version`, `type`, `title`, `iconUri`, `sourceUrl`, `rootRequired` (`false`), `ipkUrl`, `ipkSize`, `ipkHash.sha256` and `installedSize`.
   The hash and size describe one exact IPK: **generate a new manifest for every release, right after building the IPK you attach** (rebuilding the IPK changes the hash). Do not write it by hand or reuse the previous one. The manifest is not committed (`out/` is ignored): it only goes into the release.
3. Create a GitHub release (tag `v<version>`) and attach **both** the IPK and `com.twitchlite.app.manifest.json`, so that
   `https://github.com/adamff-dev/twitch-lite-webos/releases/latest/download/com.twitchlite.app.manifest.json` resolves.
4. Fork https://github.com/webosbrew/apps-repo, copy `com.twitchlite.app.yml` from this folder to `packages/`, and open a pull request.
5. Optional: `webosbrew-toolbox-ipk-verify` shows which firmware versions the IPK should work on.
