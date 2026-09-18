# Privacy — Saevyn Reverie Community 1.5.10

Saevyn Community Theme runs locally in the browser on `chatgpt.com` and changes presentation only.

The distributed v1.5.10 script:

- declares no privileged userscript APIs (`@grant none`);
- contains no telemetry, analytics, cookies, or remote service integration;
- does not call `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon`;
- does not save or transmit conversation text;
- contains no personal names, household portraits, divider images, or brand/favicon images;
- renders speaker ornaments using CSS hairlines and the configured text sigil only.

The appearance panel stores one local browser preference record named `saevyn-community-settings-v1`. It contains only the selected colors, font preset names, speaker-separation switch, active speaker roster, display names, and configured speaker-detection symbols. It contains no account identifiers or conversation text. Resetting the userscript manager/site storage removes it.

Speaker detection examines rendered assistant text in the current page only to determine whether a paragraph begins with a configured sigil. That text is not persisted or sent elsewhere by Saevyn.

Users can add an HTTPS page background in the configuration. Doing so causes the browser to request that image from its host, which can expose the usual request metadata to that host. Use a `data:image/...` URL or leave the value empty to avoid that external request. Community has no avatar setting.
