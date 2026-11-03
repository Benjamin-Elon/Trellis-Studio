# Trellis layered surfaces

Trellis dialogs and floating panels share an explicit surface hierarchy. Section builders retain ownership of spacing, scrolling, disclosure state, focus, dragging, and stacking. Shared CSS supplies surface colors, borders, radii, and main-section elevation.

## Applying roles

Add `trellis-surfaces` to the component's palette owner, then set `data-trellis-surface` on existing elements. Assign roles by meaning in the builder; DOM depth alone does not describe section hierarchy.

| Role | Use | Appearance |
| --- | --- | --- |
| `canvas` | Scroll body or background between sections | Base mixed with 6% ink |
| `section` | Main section or card | Base, neutral border, 8px radius, small shadow |
| `header` | Existing section heading | Base mixed with 10% ink |
| `inset` | Nested group | Base mixed with 3% ink, border, 6px radius |
| `entry` | Individual record or compact content surface | Base and neutral border color; existing border width remains |

Direct headers inside an inset use the inset shade, so nested headings have less contrast than main headings. Header corners inherit the parent radius without introducing clipping. Roles do not set padding, margins, positioning, z-index, overflow, animation, or text color. Tables, selected rows, warnings, status chips, previews, and controls keep their existing treatments.

`Trellis.ui.ensureSurfaceStyles(document)` installs the stylesheet once per document. The shared plugin invokes it before editor installation; callers rendering into another document can invoke it with that document. Reloading the plugin does not duplicate styles.

Remove conflicting inline surface declarations at adoption sites. Keep local fallbacks where useful for standalone plugin hosts. Do not resolve precedence with global selectors or additional `!important` rules.

## Palette ownership

`--trellis-surface-base` defaults to white and `--trellis-surface-ink` to `#172033`. Canvas, header, inset, border, and shadow are derived/customizable properties under the same prefix. The border mixes 24% ink into the base; section shadow is `0 1px 3px rgba(0,0,0,.12)`.

Override base and ink on the palette owner to preserve an existing palette. Quickstart retains `#F5F0E6` beige. Projects and splash/license cards retain warm off-white. Inventories retain their existing editor-variable fallbacks.

Only forms that already inherit the editor palette use `data-trellis-surface-theme="editor"`. Their light/dark base and ink follow the host color scheme and existing editor variables. Fixed-light forms remain light. No new theme preference or status/control recoloring is introduced.

## Adoption audit

| Component family | Surface mapping |
| --- | --- |
| Year Plan and package/crop pickers | Scroll/strip bodies: canvas; strips/summary: section; channels/editor panes: inset; demand/self/package rows: entry; headings: header |
| Planting Scheduler and crop editor | Tab/editor canvas; main sections and task recipe/timeline: section; Advanced, recipe groups, task editor: inset; headings: header |
| Equipment | Editor canvas; cards: section; disclosure groups: inset; grouped fields: entry; headings: header |
| Irrigation dialogs and HUDs | Catalog canvas; catalog form, completed BOM, HUD sections: section; catalog list: inset; headings: header |
| Allocate | HUD canvas, neutral header, inset draft summary; semantic warnings retain their colors |
| Quickstart | Beige palette owner; header band and compact body; existing floating/companion placement |
| Object details, comments, alerts | Panel header; comments canvas; resolved/unresolved groups: section; private composer: inset; posted comments: entry |
| People/access/team permissions | Main people sections: section; user/subject groups: inset; labels: header |
| Sharing/activity and incoming reviews | Existing shells; technical/recovery disclosures: inset; incoming groups: section; before/after: inset |
| Projects, identity, invitations | Warm canvas; project/join/access-request groups: section; identity/pending invitation groups: inset |
| Splash/license/support | Warm information/license/contact cards: section; headings: header; source and shipped bundle aligned |
| Guide, inventories, references, API keys, task hours, planting overlays, Updates & Links | Existing groups receive roles appropriate to their current structure |
| Roadmap, garden settings, city manager | Simple forms keep one surface; city monthly normals and existing planting-overlay groups receive nested roles |
| Database restore, module rename, structure discard, link/image dialogs, uncommitted-change decisions, other simple prompts | Audited as single-surface UI; no artificial sections |

Native draw.io dialogs and graph annotations, including succession mini-rails, have no shared surface role and are unaffected. Existing working-tree changes to editing, saving, docking, and collaboration remain separate.

## Verification

Run `node --test test/trellis-surfaces-electron.test.cjs` for installation across documents, production collapse/disable rebuilds, and Chromium checks of hierarchy, CSS precedence, native-style isolation, highlights, narrow/zoom layouts, light/dark editor modes, and production floating panels. Review `.test-artifacts/layered-surfaces` for screenshots.

Existing suites cover interaction and persistence. Native Quickstart dragging/companion ownership and Equipment keyboard selection load shared styles in their Electron helpers. Run `npm run test:plugins` for the complete regression suite.
