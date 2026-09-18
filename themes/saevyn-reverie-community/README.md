# Saevyn Reverie Community v1.5.10

Saevyn Reverie Community is the shareable, editable build of the Reverie ChatGPT skin: the same themes, appearance controls, reactions, responsive layouts, and current ChatGPT compatibility fixes, with an image-free public speaker ornament.

The Community build is generated directly from Reverie 1.5.10 so the two editions no longer maintain separate theme implementations. It removes household names, portraits, divider artwork, and private brand/favicon artwork while retaining every Reverie palette and look. Community speakers use the configured emoji or text sigil as a portrait anchor, a CSS hairline extending to the right, and a faint vertical thread beside the message body. A tiny inline `✦` glyph replaces the private browser favicon.

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey in a desktop browser.
2. Open `saevyn-community.user.js` in a text editor and review the clearly marked `COMMUNITY: EDIT HERE` block.
3. Import or create a new userscript in your manager, paste the entire file, and save it.
4. Reload `https://chatgpt.com/`.

Use `Alt+Shift+C` to pause or resume the theme without uninstalling it.

## Appearance settings

Click the small gear button in the lower-right corner of ChatGPT to open Saevyn's appearance panel. It previews changes live and lets you choose:

- page background, surface, accent, and text colors;
- separate interface and message font presets;
- whether sigil-based speaker separation is shown;
- the emoji or symbol that identifies each configured speaker.

Choose **Save** to keep the selection in this browser, **Cancel** to restore the last saved appearance, or **Reset defaults** to preview the original burgundy-and-gold palette. Only these appearance preferences are stored; conversation content is never saved by Saevyn.

## Customize it

The editable block is near the top of `saevyn-community.user.js`.

- Change `background.image` to an HTTPS URL or a `data:image/...` URL. Leave it empty for the built-in gradient.
- Rename speaker slots, change their sigils, and choose hex accent colors.
- Add or remove speaker entries. IDs may contain letters, numbers, underscores, and hyphens.
- Speaker headers are intentionally image-free. The configured emoji or text sigil is the only speaker emblem.

Fresh installs show two speakers. The gear menu can add or remove the available editable slots at any time; the active roster is saved locally with the rest of the appearance settings.

A divider appears when an assistant paragraph or other top-level rendered block begins with a configured sigil. For example, the default `🌙` prefix selects the `moon` style. A sigil in the middle of prose or after a soft line break is intentionally ignored. Detection symbols can be edited from the gear menu and must be unique so one speaker cannot accidentally match another. Ordinary ChatGPT replies remain undecorated.

If you use a remote HTTPS background or avatar, that image host receives a normal browser request. A `data:image/...` value stays inside the userscript.

## What it does not do

- It does not read, save, upload, or transmit conversations.
- It has no telemetry and makes no network requests of its own.
- It does not change ChatGPT account data.
- It does not include household portraits, divider images, favicon artwork, or identities from the personal build.

The script only changes the page presentation in your browser. See `PRIVACY.md` for the exact boundary.

## Test-release expectations

ChatGPT changes its interface frequently. This v1.5.10 package is intended for friends/community testing on the current site, not as a promise of permanent compatibility. When reporting a problem, include:

- browser and userscript manager;
- Saevyn Community version;
- the ChatGPT surface involved, such as Chat, Work, Settings, a modal, or project creation;
- a screenshot with private conversation content hidden.

## License and affiliation

The Community source and CSS-only ornament are available under the terms described in `LICENSE` and `ASSET-POLICY.md`. Images users choose for their own page background remain under their original owners' licenses and are not relicensed by Saevyn.

Saevyn Community Theme is an independent community project. It is not affiliated with, endorsed by, or supported by OpenAI.
