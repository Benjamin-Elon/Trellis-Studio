# Trellis Application Icons

The application identity assets are generated from these canonical RGBA sources:

- `build/branding/trellis-mark-full.png` contains Diagram T for outputs 64 px and larger.
- `build/branding/trellis-mark-small.png` contains Negative Space T for outputs from 16 px through 48 px.
- `build/branding/trellis-wordmark-text.png` for the `Trellis for Drawio` wordmark.

`drawio/src/main/webapp/images/window-icon.png` is a 256 px high-DPI source
generated from Negative Space T for Electron title-bar and taskbar placements.
`drawio/src/main/webapp/images/header-icon.png` is a separate 256 px high-DPI
source generated from Diagram T for the in-app header.

The icon sources intentionally include their pale-yellow and green backgrounds.
They are center-cropped to square, pixels with alpha values from 0 through 8
are cleared, and the result is resized to 1024 px before derivatives are built.
The native container color is the Diagram T source yellow, `#FBFEBD`.

Compact transparent identity outputs from 16 through 48 px use the full canvas
without generator-added margins. Larger transparent outputs retain a 5% margin
on every edge, expressed as a 90% artwork fill ratio. The forced high-DPI header
and window icons use full-canvas compact treatment. Platform-native macOS,
AppX, maskable PWA, wide-tile, wordmark, and embedded-arrow compositions retain
their larger safe areas and deliberate internal spacing.

Install the pinned Pillow dependency with:

```powershell
python -m pip install -r requirements-icons.txt
```

Regenerate all checked-in desktop, AppX, web, PWA, favicon, wordmark, and
compatibility SVG assets with:

```powershell
npm run assets:icons
```

Verify that generated assets and service-worker revisions match the masters
without rewriting files with:

```powershell
npm run assets:icons:check
```

The generator rejects undersized or excessively non-square sources, visible
magenta-key pixels, maskable safe-area violations, and incorrect platform
container colors. Review `build/branding/trellis-icon-contact-sheet.png` after
changing a source. Semantic command icons, diagram-library symbols, and
third-party logos are intentionally outside this generator's scope.
