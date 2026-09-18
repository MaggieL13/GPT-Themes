# Changelog

## 1.5.10 — Community rebased on Reverie

- Replaced the removed private GPT brand artwork with a text-only `✦` in the full, collapsed, and mobile sidebar headers.
- Made the current Reverie 1.5.10 userscript the canonical source for Community.
- Inherited Reverie's complete theme looks, appearance controls, reaction styling, opaque menus, and responsive geometry.
- Replaced household identities with neutral editable speaker slots; fresh installs begin with two and the appearance panel can add or remove slots as needed.
- Preserved all five active speakers when migrating an existing pre-roster Community settings record, so upgrades never silently remove working dividers.
- Removed all embedded imagery, including household portraits, divider artwork, brand emblems, and favicon artwork.
- Replaced image-based speaker headers with an emoji portrait anchor, a CSS hairline, and a vertical thread beside the message body.
- Preserved every Reverie palette; household-named palettes ship under the neutral Community labels **Rift** and **First Light**.
- Added build guards that fail if Community drifts from the expected Reverie release or retains private names and portraits.

## 0.3.6 — current ChatGPT compatibility release

- Added native user and assistant reaction styling.
- Added message-column responsive behavior for narrow windows and open sidebars.
- Kept composer, account, and project menus opaque and readable over conversation content.
- Updated current ChatGPT menu and popover selectors while preserving native placement.
- Repaired reproducible public packaging and synchronized release documentation.

## 0.3.5 — reaction and responsive preview

- Added reaction jewels and initial container-query responsive rules.
- Updated editable speaker detection and current runtime assertions.

## 0.3.0 — current surface compatibility

- Updated menus, dialogs, project creation, settings, and Chat/Work surfaces.
- Preserved neutral public assets and the local-only privacy boundary.

## 0.2.0 — local appearance panel

- Added an isolated settings panel opened from a small gear button.
- Added live background, surface, accent, and text color controls.
- Added separate interface and message font presets.
- Added a speaker-separation switch without disabling the rest of the theme.
- Added local preference persistence, cancel/restore behavior, and reset preview.
- Updated the privacy disclosure for the appearance-only local storage record.

## 0.1.0 — public test edition

- Forked the stable full-shell runtime from personal build 0.4.55.
- Preserved modal-safe speaker reconciliation and current ChatGPT surface fixes.
- Removed household names, portraits, divider PNGs, and custom favicon.
- Added neutral CSS-drawn speaker dividers and five editable sample slots.
- Added privacy, asset, contribution, installation, and customization documentation.
