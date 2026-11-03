# Offline narration <!-- NEW -->

The license oath and Quickstart use one warm American masculine voice: Kokoro `am_michael`, generated locally with full-precision weights and speed `1`. The application ships mono 24 kHz MP3 clips at 96 kbps, not the model or its runtime. Existing play/replay controls, Quickstart's identity-scoped opt-in preference, and license completion requirements remain in place. <!-- NEW -->

## Updating instructions <!-- NEW -->

`drawio/src/main/webapp/js/trellis-narration-catalog.js` owns the displayed/spoken text. `entries()` enumerates complete prompts, including field, planning, and prerequisite variants. Fixed phrases such as “your garden” keep recordings reusable; names remain visible in the guide's context controls. Record complete prompts rather than concatenating short audio fragments. <!-- NEW -->

`drawio/src/main/webapp/audio/narration/manifest.js` records the **exact text passed to the generator**, its filename, duration, and generation provenance. The generator compares strings directly. Matching text reuses the recording regardless of instruction ID, order, timestamps, code, voice settings, or generator version. Identical text shares a recording. Old entries remain available when wording reverts. Punctuation and whitespace changes count as text changes. <!-- NEW -->

Run these commands from `drawio-desktop`: <!-- NEW -->

```powershell
npm run assets:narration:check
npm run assets:narration
```

Ordinary generation checks that existing files are readable MP3s and checks stored sizes when available. `--check` additionally decodes all recordings with FFprobe/FFmpeg and reports text without recordings. A missing, unreadable, or corrupt existing file is an error: restore it from version control; ordinary generation never replaces it. When all text matches, generation does not import the generator, load a model, rewrite the manifest, or touch existing audio. Neither a model installation nor FFmpeg is needed for unchanged ordinary runs. <!-- NEW -->

New recordings are encoded and validated before publication, and the manifest is replaced atomically after each successful clip. Completed entries survive interruption; unlisted orphan files are not overwritten. Commit new audio and the updated manifest together. Cleanup of old recordings and intentional voice-wide replacement are separate operations, not part of normal generation. <!-- NEW -->

## One-time development setup <!-- NEW -->

Install Node.js and FFmpeg/FFprobe. The optional generator has its own pinned dependency lockfile; install it from its directory, not as an application dependency. The setup command downloads the pinned model revision into `.test-artifacts/narration-model`. Inference then uses local files only. <!-- NEW -->

```powershell
Push-Location tools/narration
npm ci --ignore-scripts --no-audit --no-fund
Pop-Location
node tools/narration/setup-model.mjs
node scripts/generate-narration.mjs --sample
npm run assets:narration
```

`tools/narration/model.json` records the model revision, generator version, voice, precision, and speed. Changing these settings affects only previously unrecorded text. The sample command requests the oath, a short field instruction, and a planning prompt using the same reuse rules. Review these before generating the whole catalog. Read [the generation and voice attribution](../drawio/src/main/webapp/audio/narration/NOTICE.md). <!-- NEW -->

Every Electron Builder configuration excludes `tools/narration` and `.test-artifacts`; the root application dependencies do not include Kokoro. After modifying the license constructor, run `node scripts/update-narration-runtime.mjs` to mirror only `SplashDialog` into `app.min.js`. The embedded `integrate.min.js` has no Trellis license wizard and is unaffected. <!-- NEW -->

## Playback and failure handling <!-- NEW -->

`window.TrellisNarration.play({ owner, text, onEnd, onError })` selects a clip by exact displayed text. `stop(owner)` stops only that owner's narration. A new request replaces prior playback; obsolete native callbacks cannot complete the replacement or report an error against it. Connected DOM owners are stopped if their screen is removed. Successful splash closure also cancels the oath explicitly. <!-- NEW -->

Missing clips, media errors, rejected playback, or ten seconds without media progress trigger one system-speech attempt with the same transcript. Prefer an installed local English voice. If system speech fails or does not complete within the bounded reading timeout, report one failure. Written guidance remains usable; the license retains its manual override after three failed/interrupted attempts. Cancellation never satisfies the listening requirement. <!-- NEW -->

## Validation <!-- NEW -->

```powershell
node --test test/narration-generation.test.mjs test/narration-playback.test.cjs test/garden-quickstart.test.cjs test/splash-dialog.test.cjs test/electron-builder-config.test.cjs
node --test test/narration-electron.test.cjs test/quickstart-drag-electron.test.cjs
npm run assets:narration:check
```

Controlled tests cover no-op file preservation, changed/duplicate/reverted text, interrupted generation, missing/corrupt assets, fallback, stalls, replay, cancellation, and stale completion. Quickstart fixtures verify that displayed prompts occur in the catalog. Source and application-bundle tests verify that obsolete playback cannot satisfy the oath. The native audio check blocks HTTP(S), loads the real local scripts, and requires completed playback of three representative MP3s without system fallback; diagnostics are written to `.test-artifacts/narration-electron.json`. <!-- NEW -->

Listen to every new recording against its stored text before release. Automated decoding, duration, and completion checks cannot judge warmth, pronunciation, naturalness, or missing/mispronounced words. System fallback can retain the original robotic sound, and retained historical clips increase storage. <!-- NEW -->
