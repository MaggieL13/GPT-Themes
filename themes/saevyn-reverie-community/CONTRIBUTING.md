# Contributing and remixing

Fork it, rename it, recolor it, or replace the speaker system. The MIT License permits modification and redistribution as long as its copyright and license notice remain with substantial copies of the code.

Please keep these safety boundaries in derivative releases:

1. Do not bundle images, fonts, or other assets unless you own them or have permission to redistribute them.
2. Do not present a derivative as affiliated with OpenAI.
3. If you add telemetry, storage, remote requests, or privileged userscript APIs, disclose them prominently. Do not retain the original privacy claims after changing that boundary.
4. Keep selectors semantic where possible. Avoid generated Radix IDs and other session-specific selectors.
5. Test menus, dialogs, settings, project creation, Chat/Work, and resize behavior before publishing a build.

The easiest customization path is the `COMMUNITY: EDIT HERE` block in `saevyn-community.user.js`. The distributed userscript is intentionally self-contained: no build tools or private source tree are required to edit, install, or redistribute it.
