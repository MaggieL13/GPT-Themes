// ==UserScript==
// @name         Saevyn / Reverie — Community
// @namespace    https://saevyn.local/
// @version      1.5.10
// @description  The public, privacy-sanitized build of Saevyn Reverie with editable local speakers and appearance controls.
// @author       Saevyn contributors
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
    "use strict";

    const SAEVYN_VERSION = "1.5.10";
    const SAEVYN_EDITION = "community";

    // =========================================================================
    // COMMUNITY: EDIT HERE
    //
    // Each speaker ID must use only letters, numbers, underscores, or hyphens.
    // A response is decorated when a rendered paragraph begins with its sigil.
    // Community speaker ornaments are text-only: the selected sigil becomes a
    // portrait anchor beside CSS hairlines. No portrait or divider image is loaded.
    // =========================================================================
    const SAEVYN_CONFIG = {
        enabled: true,
        debug: false,
        theme: "reverie",

        background: {
            enabled: true,
            image: "",
            imageOpacity: 0.22,
            overlayOpacity: 0.78,
            blur: 0
        },

        speakers: {
            moon:  { sigil: "🌙", name: "Moon",  accent: "#aa8bc8" },
            sun:   { sigil: "☀️", name: "Sun",   accent: "#d9b878" },
            blade: { sigil: "⚔️", name: "Blade", accent: "#7eaaa2" },
            ember: { sigil: "🔥", name: "Ember", accent: "#79669f" },
            star:  { sigil: "✦",  name: "Star",  accent: "#d8c8df" }
        }
    };

    // Community contains no embedded image assets.
    const BUILTIN_AVATARS = Object.freeze({});
    const SPEAKER_COLORS = Object.freeze({
        moon:  { accent: "#aa8bc8", soft: "rgba(116, 72, 132, 0.16)" },
        sun:   { accent: "#d9b878", soft: "rgba(151, 118, 57, 0.14)" },
        blade: { accent: "#7eaaa2", soft: "rgba(63, 111, 104, 0.14)" },
        ember: { accent: "#79669f", soft: "rgba(68, 48, 91, 0.22)" },
        star:  { accent: "#d8c8df", soft: "rgba(183, 159, 195, 0.13)" }
    });

    const TURN_SELECTOR = [
        '[data-turn="assistant"][data-turn-id]',
        '[data-testid^="conversation-turn-"][data-turn="assistant"]'
    ].join(",");

    const MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';
    const GENERATED_HEADER_SELECTOR = '[data-saevyn-generated="header"]';
    const EXCLUDED_TEXT_ANCESTOR_SELECTOR =
        "pre, code, script, style, svg, button, [aria-hidden='true'], [data-saevyn-generated]";
    const MARKDOWN_LEADER_RE = /^(?:(?:[*_~`>#]{1,8})\s*)+/u;
    const CHARACTER_SETTLE_MS = 160;
    const TURN_RETRY_MS = 80;
    let speakerSigilOverrides = null;
    let speakerNameOverrides = null;
    let activeCommunitySpeakerIds = null;

    function setActiveCommunitySpeakerIds(value) {
        activeCommunitySpeakerIds = Array.isArray(value)
            ? new Set(value.filter(speakerId => Object.hasOwn(SAEVYN_CONFIG.speakers, speakerId)))
            : null;
    }

    function clampNumber(value, minimum, maximum, fallback) {
        const number = Number(value);
        return Number.isFinite(number)
            ? Math.min(maximum, Math.max(minimum, number))
            : fallback;
    }

    function normalizeLeadingText(value) {
        let text = String(value ?? "")
            .replace(/\uFEFF/g, "")
            .trimStart();

        // A fenced code block is content, never a speaker declaration.
        if (text.startsWith("```")) return "";

        // Text read from the rendered DOM has no Markdown punctuation. This
        // small fallback also makes the pure detector safe for raw **🌙 text.
        while (MARKDOWN_LEADER_RE.test(text)) {
            text = text.replace(MARKDOWN_LEADER_RE, "").trimStart();
        }

        return text.replace(/\uFE0F/g, "");
    }

    function effectiveSpeakerSigil(speakerId, speaker) {
        const override = speakerSigilOverrides?.[speakerId];
        return String(override ?? speaker?.sigil ?? "").trim();
    }

    function setSpeakerSigilOverrides(value) {
        speakerSigilOverrides = value && typeof value === "object" ? value : null;
    }

    function effectiveSpeakerName(speakerId, speaker) {
        const fallback = String(speaker?.name ?? speakerId).trim() || speakerId;
        return String(speakerNameOverrides?.[speakerId] ?? fallback).trim() || fallback;
    }

    function setSpeakerNameOverrides(value) {
        speakerNameOverrides = value && typeof value === "object" ? value : null;
    }

    function detectSpeakerId(value, speakers = SAEVYN_CONFIG.speakers) {
        const text = normalizeLeadingText(value);

        for (const [speakerId, speaker] of Object.entries(speakers)) {
            if (activeCommunitySpeakerIds && !activeCommunitySpeakerIds.has(speakerId)) continue;
            const sigil = normalizeLeadingText(effectiveSpeakerSigil(speakerId, speaker));
            if (sigil && text.startsWith(sigil)) {
                return speakerId;
            }
        }

        return null;
    }

    function buildSpeakerRuns(blockTexts, speakers = SAEVYN_CONFIG.speakers) {
        const runs = [];
        let currentRun = null;

        blockTexts.forEach((text, index) => {
            const detectedSpeaker = detectSpeakerId(text, speakers);
            if (detectedSpeaker && currentRun?.speakerId !== detectedSpeaker) {
                currentRun = {
                    speakerId: detectedSpeaker,
                    startIndex: index,
                    endIndex: index
                };
                runs.push(currentRun);
            }

            if (currentRun) currentRun.endIndex = index;
        });

        return runs;
    }

    function hasExcludedTextAncestor(parent, boundary = null) {
        const excluded = parent?.closest?.(EXCLUDED_TEXT_ANCESTOR_SELECTOR);
        if (!excluded) return false;

        // Modal focus managers mark the still-visible application tree
        // aria-hidden while a portaled dialog is open. Only exclusions inside
        // the message boundary are meaningful to speaker detection; an
        // accessibility-state ancestor outside it must not erase the skin.
        return !boundary || boundary.contains(excluded);
    }

    const TEST_API = Object.freeze({
        version: SAEVYN_VERSION,
        normalizeLeadingText,
        effectiveSpeakerSigil,
        setSpeakerSigilOverrides,
        effectiveSpeakerName,
        setSpeakerNameOverrides,
        setActiveCommunitySpeakerIds,
        detectSpeakerId,
        buildSpeakerRuns,
        hasExcludedTextAncestor,
        clampNumber,
        edition: SAEVYN_EDITION,
        deriveAuroraColor
    });

    // The Node test harness stops here; a real userscript continues below.
    if (typeof globalThis !== "undefined" && globalThis.__SAEVYN_TEST_MODE__) {
        globalThis.__SAEVYN_TEST_API__ = TEST_API;
        return;
    }

    if (typeof document === "undefined" || !SAEVYN_CONFIG.enabled) {
        return;
    }

    // The DOM attribute crosses extension isolated worlds and userscript
    // sandboxes, preventing two installed copies from decorating the page.
    if (document.documentElement.hasAttribute("data-saevyn-runtime")) {
        console.warn(`[Saevyn ${SAEVYN_VERSION}] another runtime is already active; skipping duplicate install.`);
        return;
    }
    document.documentElement.setAttribute("data-saevyn-runtime", SAEVYN_VERSION);

    const pendingTurns = new Set();
    const clearTimers = new WeakMap();
    const settleTimers = new WeakMap();
    const retryTimers = new WeakMap();
    const retryAttempts = new WeakMap();
    const leadingSpeakerByTextNode = new WeakMap();
    let frameRequest = 0;
    let reconcileRequest = 0;
    let selectorCheckTimer = 0;
    let selectorWarningUrl = "";
    let paused = false;
    let lastUrl = location.href;

    function debug(...values) {
        if (SAEVYN_CONFIG.debug) {
            console.debug(`[Saevyn ${SAEVYN_VERSION}]`, ...values);
        }
    }

    function safeCssUrl(value) {
        const source = String(value ?? "").trim();
        if (!source) return "none";

        if (!/^(?:https:\/\/|data:image\/|blob:)/i.test(source)) {
            debug("Ignored an unsafe or unsupported visual URL.");
            return "none";
        }

        return `url("${source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}")`;
    }

    function resolveAvatar(value) {
        const source = String(value ?? "").trim();
        if (!source) return null;

        if (source.startsWith("builtin:")) {
            return BUILTIN_AVATARS[source.slice("builtin:".length)] ?? null;
        }

        return /^(?:https:\/\/|data:image\/|blob:)/i.test(source)
            ? source
            : null;
    }

    const COMMUNITY_SETTINGS_KEY = "saevyn-community-settings-v1";
    const COMMUNITY_SETTINGS_HOST_ID = "saevyn-community-settings-host";
    const COMMUNITY_THEME_PRESETS = Object.freeze({
        reverie: Object.freeze({
            name: "Reverie",
            description: "Ink indigo, moon-lilac, sea glass, old starlight",
            background: "#070915",
            surface: "#121531",
            accent: "#bcaaff",
            text: "#ecebff",
            shadow: "#0b1026",
            secondary: "#8175d6",
            glow: "#2a3f9e",
            aurora: "#5fd9cf",
            warmLight: "#d8bd82",
            muted: "#aaa8cb"
        }),
        tide: Object.freeze({
            name: "Deep Tide",
            description: "Abyssal teal, sea glass, drowned violet, pearl",
            background: "#050b12",
            surface: "#0d1c27",
            accent: "#8fd8d2",
            text: "#e7f5f3",
            shadow: "#061820",
            secondary: "#7469ad",
            glow: "#0f4d63",
            aurora: "#b9a7ff",
            warmLight: "#d5c690",
            muted: "#9fbdbd"
        }),
        rose: Object.freeze({
            name: "Rose Nocturne",
            description: "Plum dusk, rose quartz, mauve smoke, honey",
            background: "#0e0710",
            surface: "#211122",
            accent: "#f2a9c4",
            text: "#fcedf3",
            shadow: "#170a18",
            secondary: "#b96897",
            glow: "#7a2f63",
            aurora: "#d995b5",
            warmLight: "#e9b96f",
            muted: "#c9a7b8"
        }),
        moonrise: Object.freeze({
            name: "Moonrise",
            description: "Graphite night, silver, blue slate, lavender haze",
            background: "#08090c",
            surface: "#161821",
            accent: "#dde2f0",
            text: "#f4f5f9",
            shadow: "#0c1018",
            secondary: "#8490b8",
            glow: "#2a3358",
            aurora: "#c4b4ff",
            warmLight: "#cbbb91",
            muted: "#aeb4c4"
        }),
        sanctum: Object.freeze({
            name: "Sanctum",
            description: "Violet nave, ruby glass, gilt lead, incense smoke",
            background: "#0a0711",
            surface: "#1b1126",
            accent: "#d8b56d",
            text: "#f3ece1",
            shadow: "#12091a",
            secondary: "#93304f",
            glow: "#4b1f63",
            aurora: "#c2405f",
            warmLight: "#e0c27a",
            muted: "#b9a8c1"
        }),
        mucha: Object.freeze({
            name: "Mucha",
            description: "Olive ink, ochre, faded peacock, sage, cream",
            background: "#14120e",
            surface: "#24211a",
            accent: "#cfa85c",
            text: "#f1e8d3",
            shadow: "#1b190f",
            secondary: "#477a79",
            glow: "#5a4426",
            aurora: "#93a57c",
            warmLight: "#dfa94e",
            muted: "#bdb49b"
        }),
        tidepool: Object.freeze({
            name: "Tidepool",
            description: "Abyss, petroleum teal, luminous mint, pearl",
            background: "#041016",
            surface: "#0b2230",
            accent: "#7fe3c6",
            text: "#e4f6f2",
            shadow: "#061923",
            secondary: "#247f96",
            glow: "#0c5a63",
            aurora: "#5ad1ff",
            warmLight: "#d4c98e",
            muted: "#9bc2c3"
        }),
        ember: Object.freeze({
            name: "Ember",
            description: "Wine-black, dried rose, ember red, antique brass",
            background: "#080609",
            surface: "#180810",
            accent: "#c79b4f",
            text: "#eee4e7",
            shadow: "#10060b",
            secondary: "#9f394d",
            glow: "#6f2648",
            aurora: "#e0546f",
            warmLight: "#dda85d",
            muted: "#bda6ad"
        }),
        rift: Object.freeze({
            name: "Rift",
            description: "Rift violet, amethyst, cold turquoise, moonstone",
            background: "#06040a",
            surface: "#150c1f",
            accent: "#a78bd0",
            text: "#ede7f4",
            shadow: "#0d0713",
            secondary: "#725aa2",
            glow: "#3f2466",
            aurora: "#6ee0d6",
            warmLight: "#c8b993",
            muted: "#b2a5c0"
        }),
        firstLight: Object.freeze({
            name: "First Light",
            description: "Rose-black, blush copper, apricot, first light",
            background: "#0a0608",
            surface: "#1e1017",
            accent: "#e2b48f",
            text: "#f6ecee",
            shadow: "#12070b",
            secondary: "#ad6375",
            glow: "#7b3e5a",
            aurora: "#f3a9a0",
            warmLight: "#f0c373",
            muted: "#c8aeb2"
        })
    });
    const COMMUNITY_DEFAULT_SETTINGS = Object.freeze({
        themePreset: "reverie",
        background: "#070915",
        surface: "#121531",
        accent: "#bcaaff",
        text: "#ecebff",
        uiFont: "system",
        messageFont: "display",
        ornamentStyle: "hairline",
        motion: true,
        look: "reverie",
        ornamentDensity: "filigree",
        glowLevel: "none",
        livingLight: true,
        speakerSeparation: true,
        grain: true,
        ornamentTint: true,
        activeSpeakerIds: Object.freeze(Object.keys(SAEVYN_CONFIG.speakers).slice(0, 2)),
        speakerSigils: Object.freeze(Object.fromEntries(
            Object.entries(SAEVYN_CONFIG.speakers).map(([speakerId, speaker]) => [
                speakerId,
                String(speaker.sigil ?? "").trim()
            ])
        )),
        speakerNames: Object.freeze(Object.fromEntries(
            Object.entries(SAEVYN_CONFIG.speakers).map(([speakerId, speaker]) => [
                speakerId,
                String(speaker.name ?? speakerId).trim()
            ])
        ))
    });
    const COMMUNITY_FONT_PRESETS = Object.freeze({
        display: '"Palatino Linotype", Palatino, "Book Antiqua", "Iowan Old Style", Georgia, serif',
        system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
        humanist: '"Trebuchet MS", "Segoe UI", sans-serif',
        rounded: 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif',
        mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    });

    let communitySettings = null;
    let communitySettingsHost = null;

    function normalizeHexColor(value, fallback) {
        const candidate = String(value ?? "").trim();
        if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(candidate)) {
            return "#" + Array.from(candidate.slice(1), character => character + character).join("").toLowerCase();
        }
        return fallback;
    }

    function colorChannels(value) {
        const color = normalizeHexColor(value, "#000000");
        return [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
    }

    function mixHexColors(first, second, secondWeight) {
        const left = colorChannels(first);
        const right = colorChannels(second);
        const weight = clampNumber(secondWeight, 0, 1, 0.5);
        return "#" + left.map((channel, index) =>
            Math.round(channel * (1 - weight) + right[index] * weight)
                .toString(16)
                .padStart(2, "0")
        ).join("");
    }

    function hexToRgba(value, alpha) {
        const [red, green, blue] = colorChannels(value);
        return `rgba(${red}, ${green}, ${blue}, ${clampNumber(alpha, 0, 1, 1)})`;
    }

    function hslToHex(hue, saturation, lightness) {
        const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
        const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
        const match = lightness - chroma / 2;
        const sector = Math.floor(hue / 60) % 6;
        const [red, green, blue] = [
            [chroma, secondary, 0],
            [secondary, chroma, 0],
            [0, chroma, secondary],
            [0, secondary, chroma],
            [secondary, 0, chroma],
            [chroma, 0, secondary]
        ][sector];
        return "#" + [red, green, blue]
            .map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
            .join("");
    }

    // A theme's glow is its surface hue pushed to a saturated mid-dark tone:
    // wine becomes plum, blue-black becomes indigo, charcoal green becomes moss.
    // Presets may pin an explicit glow; custom palettes derive one here.
    function deriveGlowColor(surface) {
        const [red, green, blue] = colorChannels(surface).map(channel => channel / 255);
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const delta = maximum - minimum;
        const lightness = (maximum + minimum) / 2;
        const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
        if (saturation < 0.06) return mixHexColors(surface, "#ffffff", 0.16);

        let hue = 0;
        if (maximum === red) hue = ((green - blue) / delta) % 6;
        else if (maximum === green) hue = (blue - red) / delta + 2;
        else hue = (red - green) / delta + 4;
        hue = (hue * 60 + 360) % 360;
        return hslToHex(hue, Math.min(0.62, Math.max(0.42, saturation)), 0.27);
    }

    // The aurora is the second light in every Reverie sky. Presets pin it;
    // custom palettes take the accent, swing its hue toward the far side of
    // the wheel, and keep it luminous so the two lights never read as one.
    function deriveAuroraColor(accent) {
        const [red, green, blue] = colorChannels(accent).map(channel => channel / 255);
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const spread = maximum - minimum;
        let hue = 0;
        if (spread > 0) {
            if (maximum === red) hue = ((green - blue) / spread) % 6;
            else if (maximum === green) hue = (blue - red) / spread + 2;
            else hue = (red - green) / spread + 4;
            hue = (hue * 60 + 360) % 360;
        }
        return hslToHex((hue + 150) % 360, 0.62, 0.7);
    }

    const GRAIN_FILTER_ID = "saevyn-grain";

    // Fine film grain over the fixed atmosphere layer. An inline SVG filter is
    // used instead of a data: texture so ChatGPT's img-src policy cannot block
    // it; the class is only added once the filter exists in the document, so a
    // dangling filter reference can never blank the overlay.
    function ensureGrainFilter(enabled) {
        const body = document.body;
        if (!body) return;
        let svg = document.getElementById(GRAIN_FILTER_ID + "-svg");
        if (!svg && enabled) {
            const namespace = "http://www.w3.org/2000/svg";
            svg = document.createElementNS(namespace, "svg");
            svg.id = GRAIN_FILTER_ID + "-svg";
            svg.dataset.saevynGenerated = "grain";
            svg.setAttribute("aria-hidden", "true");
            svg.setAttribute("focusable", "false");
            svg.setAttribute("width", "0");
            svg.setAttribute("height", "0");
            svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";

            const filter = document.createElementNS(namespace, "filter");
            filter.id = GRAIN_FILTER_ID;
            filter.setAttribute("x", "0");
            filter.setAttribute("y", "0");
            filter.setAttribute("width", "100%");
            filter.setAttribute("height", "100%");
            filter.setAttribute("color-interpolation-filters", "sRGB");

            const turbulence = document.createElementNS(namespace, "feTurbulence");
            turbulence.setAttribute("type", "fractalNoise");
            turbulence.setAttribute("baseFrequency", "0.82");
            turbulence.setAttribute("numOctaves", "2");
            turbulence.setAttribute("stitchTiles", "stitch");
            turbulence.setAttribute("seed", "7");
            turbulence.setAttribute("result", "noise");

            const matrix = document.createElementNS(namespace, "feColorMatrix");
            matrix.setAttribute("in", "noise");
            matrix.setAttribute("type", "matrix");
            matrix.setAttribute("values", "0 0 0 0 0.56  0 0 0 0 0.52  0 0 0 0 0.54  0 0 0 0.09 0");
            matrix.setAttribute("result", "grain");

            const composite = document.createElementNS(namespace, "feComposite");
            composite.setAttribute("in", "grain");
            composite.setAttribute("in2", "SourceGraphic");
            composite.setAttribute("operator", "over");

            filter.append(turbulence, matrix, composite);
            svg.append(filter);
            body.append(svg);
        }
        body.classList.toggle("saevyn-grain", Boolean(enabled && svg));
    }

    // Divider rails, endpoints, and sigil emblems are gold artwork. When a
    // theme's accent leaves antique gold, the decoded canvases are recolored
    // with a hue/saturation ("color") composite so the engraving keeps its
    // shading. Covenant's own accent is a no-op and stays pixel-identical.
    const DEFAULT_ORNAMENT_ACCENT = "#c79b4f";
    // Community ornaments are CSS and text; there are no canvases to tint.
    function syncOrnamentTint() {}

    function normalizeConfiguredSigil(value, fallback) {
        const candidate = Array.from(String(value ?? "").trim()).slice(0, 8).join("");
        return normalizeLeadingText(candidate) ? candidate : fallback;
    }

    function normalizeSpeakerSigils(value) {
        const candidate = value && typeof value === "object" ? value : {};
        const normalized = Object.fromEntries(
            Object.entries(COMMUNITY_DEFAULT_SETTINGS.speakerSigils).map(([speakerId, fallback]) => [
                speakerId,
                normalizeConfiguredSigil(candidate[speakerId], fallback)
            ])
        );
        const entries = Object.entries(normalized);
        const conflicted = new Set();

        for (let index = 0; index < entries.length; index += 1) {
            const left = normalizeLeadingText(entries[index][1]);
            for (let comparison = index + 1; comparison < entries.length; comparison += 1) {
                const right = normalizeLeadingText(entries[comparison][1]);
                if (left.startsWith(right) || right.startsWith(left)) {
                    conflicted.add(entries[index][0]);
                    conflicted.add(entries[comparison][0]);
                }
            }
        }
        for (const speakerId of conflicted) {
            normalized[speakerId] = COMMUNITY_DEFAULT_SETTINGS.speakerSigils[speakerId];
        }

        return normalized;
    }

    function normalizeSpeakerNames(value) {
        const candidate = value && typeof value === "object" ? value : {};
        return Object.fromEntries(
            Object.entries(COMMUNITY_DEFAULT_SETTINGS.speakerNames).map(([speakerId, fallback]) => {
                const name = Array.from(String(candidate[speakerId] ?? "").trim()).slice(0, 32).join("");
                return [speakerId, name || fallback];
            })
        );
    }

    function normalizeActiveCommunitySpeakerIds(value) {
        const available = Object.keys(SAEVYN_CONFIG.speakers);
        const requested = Array.isArray(value)
            ? value
            : COMMUNITY_DEFAULT_SETTINGS.activeSpeakerIds;
        return Array.from(new Set(requested.filter(speakerId => available.includes(speakerId))));
    }

    function normalizeCommunitySettings(value) {
        const candidate = value && typeof value === "object" ? value : {};
        const uiFont = Object.hasOwn(COMMUNITY_FONT_PRESETS, candidate.uiFont)
            ? candidate.uiFont
            : COMMUNITY_DEFAULT_SETTINGS.uiFont;
        const messageFont = Object.hasOwn(COMMUNITY_FONT_PRESETS, candidate.messageFont)
            ? candidate.messageFont
            : COMMUNITY_DEFAULT_SETTINGS.messageFont;

        const colors = {
            background: normalizeHexColor(candidate.background, COMMUNITY_DEFAULT_SETTINGS.background),
            surface: normalizeHexColor(candidate.surface, COMMUNITY_DEFAULT_SETTINGS.surface),
            accent: normalizeHexColor(candidate.accent, COMMUNITY_DEFAULT_SETTINGS.accent),
            text: normalizeHexColor(candidate.text, COMMUNITY_DEFAULT_SETTINGS.text)
        };
        const matchingPreset = Object.entries(COMMUNITY_THEME_PRESETS).find(([, preset]) =>
            ["background", "surface", "accent", "text"].every(name => colors[name] === preset[name])
        )?.[0];
        const requestedPreset = String(candidate.themePreset ?? "");
        const themePreset = requestedPreset === "custom"
            ? "custom"
            : Object.hasOwn(COMMUNITY_THEME_PRESETS, requestedPreset)
                ? requestedPreset
                : matchingPreset ?? "custom";

        return {
            themePreset,
            ...colors,
            uiFont,
            messageFont,
            speakerSeparation: candidate.speakerSeparation !== false,
            grain: candidate.grain !== false,
            ornamentTint: candidate.ornamentTint !== false,
            ornamentStyle: "hairline",
            motion: candidate.motion !== false,
            look: ["reverie", "cathedral", "nouveau", "tidepool"].includes(candidate.look) ? candidate.look : "reverie",
            ornamentDensity: ["quiet", "filigree", "opulent"].includes(candidate.ornamentDensity) ? candidate.ornamentDensity : "filigree",
            glowLevel: ["none", "soft", "bright"].includes(candidate.glowLevel) ? candidate.glowLevel : "none",
            livingLight: candidate.livingLight !== false,
            activeSpeakerIds: normalizeActiveCommunitySpeakerIds(candidate.activeSpeakerIds),
            speakerSigils: normalizeSpeakerSigils(candidate.speakerSigils),
            speakerNames: normalizeSpeakerNames(candidate.speakerNames)
        };
    }

    function loadCommunitySettings() {
        try {
            const saved = localStorage.getItem(COMMUNITY_SETTINGS_KEY);
            if (!saved) return normalizeCommunitySettings(COMMUNITY_DEFAULT_SETTINGS);
            const parsed = JSON.parse(saved);
            // Builds before the editable roster always exposed all five slots.
            // Preserve that existing installation on first migration; only a
            // deliberate add/remove action should change its active speakers.
            if (!Array.isArray(parsed?.activeSpeakerIds)) {
                parsed.activeSpeakerIds = Object.keys(SAEVYN_CONFIG.speakers);
            }
            return normalizeCommunitySettings(parsed);
        } catch (error) {
            console.warn(`[Saevyn ${SAEVYN_VERSION}] Could not load local appearance settings.`, error);
            return normalizeCommunitySettings(COMMUNITY_DEFAULT_SETTINGS);
        }
    }

    function persistCommunitySettings(value) {
        communitySettings = normalizeCommunitySettings(value);
        try {
            localStorage.setItem(COMMUNITY_SETTINGS_KEY, JSON.stringify(communitySettings));
        } catch (error) {
            console.warn(`[Saevyn ${SAEVYN_VERSION}] Appearance changed, but could not be saved locally.`, error);
        }
        applyCommunitySettings(communitySettings);
    }

    function syncSpeakerSeparation(enabled) {
        document.body.classList.toggle("saevyn-speaker-separation-disabled", !enabled);
        if (enabled) {
            queueReconcile();
            return;
        }

        for (const turn of document.querySelectorAll(`${TURN_SELECTOR}, .saevyn-turn`)) {
            clearClassification(turn);
        }
        for (const header of document.querySelectorAll(GENERATED_HEADER_SELECTOR)) {
            header.remove();
        }
    }

    function applyCommunitySettings(value, { syncSpeakers = true } = {}) {
        const settings = normalizeCommunitySettings(value);
        const root = document.documentElement;
        const presetRoles = COMMUNITY_THEME_PRESETS[settings.themePreset]?.roles ?? {};
        const backgroundDeep = mixHexColors(settings.background, "#000000", 0.28);
        const surfaceDeep = mixHexColors(settings.surface, "#000000", 0.34);
        const surfaceRaised = mixHexColors(settings.surface, "#ffffff", 0.07);
        const surfaceHigh = mixHexColors(settings.surface, "#ffffff", 0.14);
        const sidebar = presetRoles.sidebar ?? settings.surface;
        const sidebarDeep = presetRoles.sidebarDeep ?? surfaceDeep;
        const panelSubtle = presetRoles.panelSubtle ?? surfaceRaised;
        const panel = presetRoles.panel ?? surfaceRaised;
        // The legacy presets intentionally keep all semanticized decorative
        // wine on the same panel tone. Only presets with explicit roles opt in
        // to the richer hierarchy, so Covenant remains pixel-stable.
        const panelSelected = presetRoles.panelSelected ?? surfaceRaised;
        const nativeSurfaceHigh = presetRoles.panelSelected ?? surfaceHigh;
        const accentDeep = mixHexColors(settings.accent, "#000000", 0.38);
        const accentLight = mixHexColors(settings.accent, "#ffffff", 0.38);
        const mutedText = mixHexColors(settings.text, settings.surface, 0.34);
        const glow = normalizeHexColor(
            COMMUNITY_THEME_PRESETS[settings.themePreset]?.glow,
            deriveGlowColor(settings.surface)
        );
        const palette = COMMUNITY_THEME_PRESETS[settings.themePreset] ?? {};
        const aurora = normalizeHexColor(
            palette.aurora,
            deriveAuroraColor(settings.accent)
        );
        const secondary = normalizeHexColor(palette.secondary, aurora);
        const warmLight = normalizeHexColor(palette.warmLight, accentLight);
        const atmosphereShadow = normalizeHexColor(palette.shadow, backgroundDeep);
        const paletteMuted = normalizeHexColor(palette.muted, mutedText);

        const variables = {
            "--saevyn-bg": settings.background,
            "--saevyn-sidebar": hexToRgba(sidebar, 0.985),
            "--saevyn-sidebar-deep": hexToRgba(sidebarDeep, 0.995),
            "--saevyn-panel-subtle": hexToRgba(panelSubtle, 0.92),
            "--saevyn-panel": hexToRgba(panel, 0.94),
            "--saevyn-panel-selected": hexToRgba(panelSelected, 0.96),
            "--saevyn-border": hexToRgba(settings.accent, 0.28),
            "--saevyn-text": settings.text,
            "--saevyn-muted": paletteMuted,
            "--saevyn-gold-shadow": accentDeep,
            "--saevyn-gold-deep": accentDeep,
            "--saevyn-gold": settings.accent,
            "--saevyn-gold-light": accentLight,
            "--saevyn-accent-fill": settings.accent,
            "--saevyn-accent-fill-hover": accentLight,
            "--saevyn-accent-fill-deep": accentDeep,
            "--saevyn-accent-ink": backgroundDeep,
            "--saevyn-accent-text": accentLight,
            "--saevyn-accent-soft": hexToRgba(settings.accent, 0.15),
            "--saevyn-accent-press": hexToRgba(settings.accent, 0.24),
            "--saevyn-accent-outline": hexToRgba(accentLight, 0.52),
            "--saevyn-line": hexToRgba(settings.accent, 0.18),
            "--saevyn-line-strong": hexToRgba(settings.accent, 0.38),
            "--saevyn-accent-wash": hexToRgba(settings.accent, 0.10),
            "--saevyn-accent-wash-strong": hexToRgba(settings.accent, 0.24),
            "--saevyn-glow": glow,
            "--saevyn-glow-deep": mixHexColors(glow, "#000000", 0.35),
            "--saevyn-aurora": aurora,
            "--saevyn-aurora-soft": hexToRgba(aurora, 0.18),
            "--saevyn-secondary": secondary,
            "--saevyn-secondary-soft": hexToRgba(secondary, 0.18),
            "--saevyn-warm": warmLight,
            "--saevyn-warm-soft": hexToRgba(warmLight, 0.16),
            "--saevyn-atmosphere-shadow": atmosphereShadow,
            "--saevyn-palette-muted": paletteMuted,
            "--saevyn-ui-font": COMMUNITY_FONT_PRESETS[settings.uiFont],
            "--saevyn-message-font": COMMUNITY_FONT_PRESETS[settings.messageFont],
            "--bg-primary": settings.background,
            "--bg-elevated-primary": panel,
            "--bg-secondary-surface": panel,
            "--main-surface-background": hexToRgba(settings.background, 0.96),
            "--main-surface-primary": settings.background,
            "--main-surface-secondary": panel,
            "--main-surface-tertiary": nativeSurfaceHigh,
            "--sidebar-surface": sidebar,
            "--sidebar-surface-primary": sidebar,
            "--sidebar-surface-secondary": panel,
            "--sidebar-surface-tertiary": nativeSurfaceHigh,
            "--composer-surface-primary": panel,
            "--composer-surface": hexToRgba(panel, 0.92),
            ...(presetRoles.panelSelected ? {
                "--surface-hover": hexToRgba(panelSelected, 0.78),
                "--interactive-bg-tertiary-default": panel,
                "--interactive-bg-tertiary-inactive": panel,
                "--interactive-bg-tertiary-selected": panelSelected
            } : {}),
            "--text-primary": settings.text,
            "--text-secondary": mixHexColors(settings.text, settings.surface, 0.18),
            "--text-tertiary": mutedText
        };

        for (const [name, setting] of Object.entries(variables)) {
            root.style.setProperty(name, setting);
        }

        if (communitySettingsHost) {
            communitySettingsHost.style.setProperty("--settings-bg", surfaceDeep);
            communitySettingsHost.style.setProperty("--settings-panel", panel);
            communitySettingsHost.style.setProperty("--settings-accent", settings.accent);
            communitySettingsHost.style.setProperty("--settings-accent-light", accentLight);
            communitySettingsHost.style.setProperty("--settings-text", settings.text);
            communitySettingsHost.style.setProperty("--settings-muted", mutedText);
            communitySettingsHost.style.setProperty("--settings-font", COMMUNITY_FONT_PRESETS[settings.uiFont]);
        }

        root.dataset.saevynOrnaments = settings.ornamentStyle;
        root.dataset.saevynMotion = settings.motion ? "drift" : "still";
        root.dataset.saevynLook = settings.look;
        root.dataset.saevynDensity = settings.ornamentDensity;
        root.dataset.saevynGlow = settings.glowLevel;
        delete root.dataset.saevynWeather;
        root.dataset.saevynLantern = settings.livingLight ? "on" : "off";
        ensureGrainFilter(settings.grain);
        syncOrnamentTint(settings.ornamentTint ? settings.accent : null);

        if (syncSpeakers) {
            setActiveCommunitySpeakerIds(settings.activeSpeakerIds);
            setSpeakerSigilOverrides(settings.speakerSigils);
            setSpeakerNameOverrides(settings.speakerNames);
            syncRenderedSpeakerNames();
            syncSpeakerSeparation(settings.speakerSeparation);
        }
    }

    function readCommunitySettingsForm(shadow) {
        const activeSpeakerIds = Array.from(
            shadow.querySelectorAll("[data-speaker-row]"),
            row => row.dataset.speakerRow
        );
        const speakerNames = Object.fromEntries(
            Array.from(shadow.querySelectorAll("[data-speaker-name]"), input => [
                input.dataset.speakerName,
                input.value
            ])
        );
        const speakerSigils = Object.fromEntries(
            Array.from(shadow.querySelectorAll("[data-speaker-sigil]"), input => [
                input.dataset.speakerSigil,
                input.value
            ])
        );
        return normalizeCommunitySettings({
            themePreset: shadow.querySelector('[name="themePreset"]:checked')?.value ?? "custom",
            background: shadow.querySelector('[name="background"]').value,
            surface: shadow.querySelector('[name="surface"]').value,
            accent: shadow.querySelector('[name="accent"]').value,
            text: shadow.querySelector('[name="text"]').value,
            uiFont: shadow.querySelector('[name="uiFont"]').value,
            messageFont: shadow.querySelector('[name="messageFont"]').value,
            speakerSeparation: shadow.querySelector('[name="speakerSeparation"]').checked,
            grain: shadow.querySelector('[name="grain"]').checked,
            ornamentTint: shadow.querySelector('[name="ornamentTint"]').checked,
            ornamentStyle: shadow.querySelector('[name="ornamentStyle"]').value,
            motion: shadow.querySelector('[name="motion"]').checked,
            look: shadow.querySelector('[name="look"]').value,
            ornamentDensity: shadow.querySelector('[name="ornamentDensity"]').value,
            glowLevel: shadow.querySelector('[name="glowLevel"]').value,
            livingLight: shadow.querySelector('[name="livingLight"]').checked,
            activeSpeakerIds,
            speakerSigils,
            speakerNames
        });
    }

    function updateCommunitySpeakerControls(shadow) {
        const count = shadow.querySelectorAll("[data-speaker-row]").length;
        const countLabel = shadow.querySelector(".speaker-count");
        const addButton = shadow.querySelector(".add-speaker");
        if (countLabel) countLabel.textContent = count + (count === 1 ? " speaker configured" : " speakers configured");
        if (addButton) addButton.disabled = count >= Object.keys(SAEVYN_CONFIG.speakers).length;
    }

    function appendCommunitySpeakerRow(shadow, speakerId, settings) {
        const speaker = SAEVYN_CONFIG.speakers[speakerId];
        if (!speaker) return null;
        const row = document.createElement("div");
        const nameInput = document.createElement("input");
        const sigilInput = document.createElement("input");
        const removeButton = document.createElement("button");
        const displayName = settings?.speakerNames?.[speakerId] ?? speaker.name;
        row.className = "sigil-row";
        row.dataset.speakerRow = speakerId;
        nameInput.className = "speaker-name-input";
        nameInput.type = "text";
        nameInput.required = true;
        nameInput.maxLength = 32;
        nameInput.autocomplete = "off";
        nameInput.spellcheck = false;
        nameInput.dataset.speakerName = speakerId;
        nameInput.value = displayName;
        nameInput.setAttribute("aria-label", displayName + " display name");
        sigilInput.className = "sigil-input";
        sigilInput.type = "text";
        sigilInput.required = true;
        sigilInput.maxLength = 16;
        sigilInput.autocomplete = "off";
        sigilInput.spellcheck = false;
        sigilInput.dataset.speakerSigil = speakerId;
        sigilInput.value = settings?.speakerSigils?.[speakerId] ?? speaker.sigil;
        sigilInput.setAttribute("aria-label", displayName + " detection symbol");
        removeButton.className = "remove-speaker";
        removeButton.type = "button";
        removeButton.dataset.removeSpeaker = speakerId;
        removeButton.setAttribute("aria-label", "Remove " + displayName);
        removeButton.title = "Remove speaker";
        removeButton.textContent = "−";
        row.append(nameInput, sigilInput, removeButton);
        shadow.querySelector(".sigils").append(row);
        updateCommunitySpeakerControls(shadow);
        return row;
    }

    function renderCommunitySpeakerRows(shadow, settings) {
        const list = shadow.querySelector(".sigils");
        list.replaceChildren();
        for (const speakerId of settings.activeSpeakerIds) {
            appendCommunitySpeakerRow(shadow, speakerId, settings);
        }
        updateCommunitySpeakerControls(shadow);
    }

    function fillCommunitySettingsForm(shadow, value) {
        const settings = normalizeCommunitySettings(value);
        const presetInput = shadow.querySelector(`[name="themePreset"][value="${settings.themePreset}"]`)
            || shadow.querySelector('[name="themePreset"][value="custom"]');
        if (presetInput) presetInput.checked = true;
        for (const name of ["background", "surface", "accent", "text", "uiFont", "messageFont"]) {
            shadow.querySelector(`[name="${name}"]`).value = settings[name];
        }
        shadow.querySelector('[name="speakerSeparation"]').checked = settings.speakerSeparation;
        shadow.querySelector('[name="grain"]').checked = settings.grain;
        shadow.querySelector('[name="ornamentTint"]').checked = settings.ornamentTint;
        shadow.querySelector('[name="ornamentStyle"]').value = settings.ornamentStyle;
        shadow.querySelector('[name="motion"]').checked = settings.motion;
        shadow.querySelector('[name="look"]').value = settings.look;
        shadow.querySelector('[name="ornamentDensity"]').value = settings.ornamentDensity;
        shadow.querySelector('[name="glowLevel"]').value = settings.glowLevel;
        shadow.querySelector('[name="livingLight"]').checked = settings.livingLight;
        renderCommunitySpeakerRows(shadow, settings);
    }

    function validateCommunitySpeakerNames(shadow) {
        const inputs = Array.from(shadow.querySelectorAll("[data-speaker-name]"));
        const error = shadow.querySelector(".name-error");
        const conflicts = new Set();
        const owners = new Map();

        for (const input of inputs) {
            input.setCustomValidity("");
            const normalized = input.value.trim().toLocaleLowerCase();
            if (!normalized) {
                input.setCustomValidity("Enter a display name.");
                conflicts.add(input);
            } else if (owners.has(normalized)) {
                conflicts.add(input);
                conflicts.add(owners.get(normalized));
            } else {
                owners.set(normalized, input);
            }
        }
        for (const input of conflicts) {
            if (!input.validationMessage) input.setCustomValidity("Use a unique display name.");
        }
        error.hidden = conflicts.size === 0;
        error.textContent = conflicts.size ? "Each speaker needs a distinct display name." : "";
        return conflicts.size === 0;
    }

    function validateCommunitySpeakerSigils(shadow) {
        const inputs = Array.from(shadow.querySelectorAll("[data-speaker-sigil]"));
        const error = shadow.querySelector(".sigil-error");
        const conflicts = new Set();

        for (const input of inputs) input.setCustomValidity("");
        for (let index = 0; index < inputs.length; index += 1) {
            const left = normalizeLeadingText(inputs[index].value);
            if (!left) {
                inputs[index].setCustomValidity("Enter an emoji or symbol.");
                conflicts.add(inputs[index]);
                continue;
            }
            for (let comparison = index + 1; comparison < inputs.length; comparison += 1) {
                const right = normalizeLeadingText(inputs[comparison].value);
                if (right && (left.startsWith(right) || right.startsWith(left))) {
                    conflicts.add(inputs[index]);
                    conflicts.add(inputs[comparison]);
                }
            }
        }

        for (const input of conflicts) {
            if (!input.validationMessage) {
                input.setCustomValidity("Use a unique symbol that does not begin with another speaker's symbol.");
            }
        }
        error.hidden = conflicts.size === 0;
        error.textContent = conflicts.size
            ? "Each speaker needs a distinct starting symbol."
            : "";
        return conflicts.size === 0;
    }

    function validateCommunitySpeakerSettings(shadow) {
        const namesValid = validateCommunitySpeakerNames(shadow);
        const sigilsValid = validateCommunitySpeakerSigils(shadow);
        return namesValid && sigilsValid;
    }

    function mountCommunitySettings() {
        if (document.getElementById(COMMUNITY_SETTINGS_HOST_ID)) return;

        communitySettingsHost = document.createElement("div");
        communitySettingsHost.id = COMMUNITY_SETTINGS_HOST_ID;
        communitySettingsHost.dataset.saevynGenerated = "settings";
        const shadow = communitySettingsHost.attachShadow({ mode: "open" });
        shadow.innerHTML = `
            <style>
                :host {
                    --settings-bg: #080609;
                    --settings-panel: #1d0c14;
                    --settings-accent: #c79b4f;
                    --settings-accent-light: #efd58c;
                    --settings-text: #eee4e7;
                    --settings-muted: #ad9fa5;
                    --settings-font: system-ui, sans-serif;
                    position: fixed;
                    z-index: 2147483600;
                    right: 18px;
                    bottom: 20px;
                    font-family: var(--settings-font);
                    color: var(--settings-text);
                }
                * { box-sizing: border-box; }
                [hidden] { display: none !important; }
                button, input, select { font: inherit; }
                .launcher {
                    display: grid;
                    width: 42px;
                    height: 42px;
                    place-items: center;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 56%, transparent);
                    border-radius: 50%;
                    background: color-mix(in srgb, var(--settings-panel) 92%, transparent);
                    color: var(--settings-accent-light);
                    box-shadow: 0 10px 30px rgba(0,0,0,.42), inset 0 0 15px color-mix(in srgb, var(--settings-accent) 10%, transparent);
                    cursor: pointer;
                    backdrop-filter: blur(12px);
                }
                .launcher:hover, .launcher:focus-visible {
                    border-color: var(--settings-accent-light);
                    outline: none;
                    transform: translateY(-1px);
                }
                .launcher-glyph { display: block; font: 400 22px/1 "Segoe UI Symbol", sans-serif; }
                .backdrop {
                    position: fixed;
                    z-index: 2147483601;
                    inset: 0;
                    display: grid;
                    place-items: center;
                    padding: 18px;
                    background: rgba(0,0,0,.62);
                    backdrop-filter: blur(8px);
                }
                .panel {
                    width: min(520px, 100%);
                    max-height: min(860px, calc(100vh - 36px));
                    overflow: auto;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 44%, transparent);
                    border-radius: 20px;
                    background: linear-gradient(155deg, color-mix(in srgb, var(--settings-panel) 94%, white 6%), var(--settings-bg));
                    box-shadow: 0 26px 90px rgba(0,0,0,.62), inset 0 1px rgba(255,255,255,.05);
                }
                .header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 20px;
                    padding: 22px 22px 14px;
                    border-bottom: 1px solid color-mix(in srgb, var(--settings-accent) 20%, transparent);
                }
                h2 { margin: 0; font: 650 1.2rem/1.2 ui-serif, Georgia, serif; color: var(--settings-accent-light); }
                .subtitle { margin: 7px 0 0; color: var(--settings-muted); font-size: .82rem; line-height: 1.45; }
                .close {
                    border: 0;
                    background: transparent;
                    color: var(--settings-muted);
                    font-size: 1.4rem;
                    cursor: pointer;
                }
                .close:hover, .close:focus-visible { color: var(--settings-text); outline: none; }
                form { padding: 18px 22px 22px; }
                fieldset { margin: 0 0 20px; padding: 0; border: 0; }
                legend {
                    margin-bottom: 10px;
                    color: var(--settings-accent-light);
                    font-size: .7rem;
                    font-weight: 750;
                    letter-spacing: .14em;
                    text-transform: uppercase;
                }
                .presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
                .preset-card { position: relative; display: block; min-width: 0; cursor: pointer; }
                .preset-card input { position: absolute; opacity: 0; pointer-events: none; }
                .preset-face {
                    display: grid;
                    min-height: 92px;
                    padding: 12px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 18%, transparent);
                    border-radius: 13px;
                    background: color-mix(in srgb, var(--settings-panel) 78%, transparent);
                    transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
                }
                .preset-card:hover .preset-face { border-color: color-mix(in srgb, var(--settings-accent) 46%, transparent); transform: translateY(-1px); }
                .preset-card input:focus-visible + .preset-face { outline: 2px solid var(--settings-accent-light); outline-offset: 2px; }
                .preset-card input:checked + .preset-face {
                    border-color: var(--settings-accent);
                    background: color-mix(in srgb, var(--settings-accent) 10%, var(--settings-panel));
                    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--settings-accent) 16%, transparent), 0 5px 18px rgba(0,0,0,.18);
                }
                .preset-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
                .preset-name { color: var(--settings-text); font-size: .84rem; font-weight: 700; }
                .preset-swatches { display: flex; flex: 0 0 auto; overflow: hidden; border: 1px solid color-mix(in srgb, var(--settings-text) 20%, transparent); border-radius: 999px; }
                .preset-swatch { width: 13px; height: 13px; }
                .preset-description { align-self: end; margin-top: 10px; color: var(--settings-muted); font-size: .7rem; line-height: 1.35; }
                .custom-palette {
                    margin-top: 10px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 18%, transparent);
                    border-radius: 12px;
                    background: color-mix(in srgb, var(--settings-panel) 66%, transparent);
                }
                .custom-palette summary { padding: 11px 12px; color: var(--settings-muted); font-size: .78rem; font-weight: 650; cursor: pointer; }
                .custom-palette[open] summary { color: var(--settings-accent-light); }
                .custom-palette .colors { padding: 0 10px 10px; }
                .colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
                .color-row, .select-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    min-height: 48px;
                    padding: 10px 12px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 18%, transparent);
                    border-radius: 12px;
                    background: color-mix(in srgb, var(--settings-panel) 78%, transparent);
                    color: var(--settings-text);
                    font-size: .86rem;
                }
                input[type="color"] {
                    width: 38px;
                    height: 30px;
                    padding: 2px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 35%, transparent);
                    border-radius: 8px;
                    background: transparent;
                    cursor: pointer;
                }
                .fonts { display: grid; gap: 10px; }
                select {
                    min-width: 155px;
                    padding: 7px 30px 7px 10px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 32%, transparent);
                    border-radius: 9px;
                    background: var(--settings-bg);
                    color: var(--settings-text);
                }
                .sigil-help { margin: -2px 0 10px; color: var(--settings-muted); font-size: .76rem; line-height: 1.45; }
                .speaker-details {
                    margin: 0 0 20px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 18%, transparent);
                    border-radius: 12px;
                    background: color-mix(in srgb, var(--settings-panel) 66%, transparent);
                }
                .speaker-details summary {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 14px;
                    min-height: 50px;
                    padding: 10px 12px;
                    color: var(--settings-accent-light);
                    cursor: pointer;
                    list-style: none;
                }
                .speaker-details summary::-webkit-details-marker { display: none; }
                .speaker-details summary::after { content: "＋"; color: var(--settings-muted); font-size: 1rem; }
                .speaker-details[open] summary::after { content: "−"; }
                .speaker-details summary strong { display: block; font-size: .84rem; }
                .speaker-details summary span { display: block; margin-top: 2px; color: var(--settings-muted); font-size: .72rem; }
                .speaker-details-body { padding: 0 12px 12px; }
                .sigils { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
                .sigil-row {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 72px 34px;
                    align-items: center;
                    gap: 12px;
                    min-height: 48px;
                    padding: 8px 10px 8px 12px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 18%, transparent);
                    border-radius: 12px;
                    background: color-mix(in srgb, var(--settings-panel) 78%, transparent);
                    color: var(--settings-text);
                    font-size: .84rem;
                }
                .speaker-name-input, .sigil-input {
                    width: 100%;
                    min-width: 0;
                    padding: 7px 8px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 32%, transparent);
                    border-radius: 9px;
                    background: var(--settings-bg);
                    color: var(--settings-text);
                    font: inherit;
                }
                .speaker-name-input { text-align: left; }
                .sigil-input {
                    font-size: 1rem;
                    text-align: center;
                }
                .speaker-name-input:invalid, .sigil-input:invalid { border-color: #d97878; outline: 1px solid color-mix(in srgb, #d97878 55%, transparent); }
                .remove-speaker, .add-speaker {
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 30%, transparent);
                    background: color-mix(in srgb, var(--settings-bg) 70%, transparent);
                    color: var(--settings-muted);
                    cursor: pointer;
                }
                .remove-speaker { width: 34px; height: 34px; padding: 0; border-radius: 50%; font-size: 1.15rem; line-height: 1; }
                .remove-speaker:hover, .remove-speaker:focus-visible, .add-speaker:hover, .add-speaker:focus-visible { border-color: var(--settings-accent-light); color: var(--settings-text); outline: none; }
                .add-speaker { width: 100%; min-height: 40px; margin-top: 10px; border-radius: 10px; font-weight: 650; }
                .add-speaker:disabled { opacity: .42; cursor: not-allowed; }
                .field-error { margin: 9px 0 0; color: #e8a2a2; font-size: .76rem; }
                .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
                .toggle-row + .toggle-row { margin-top: 12px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--settings-accent) 14%, transparent); }
                .toggle-copy strong { display: block; font-size: .9rem; }
                .toggle-copy span { display: block; margin-top: 4px; color: var(--settings-muted); font-size: .76rem; line-height: 1.4; }
                .switch { position: relative; flex: 0 0 auto; width: 48px; height: 28px; }
                .switch input { position: absolute; opacity: 0; pointer-events: none; }
                .track {
                    position: absolute;
                    inset: 0;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 35%, transparent);
                    border-radius: 999px;
                    background: color-mix(in srgb, var(--settings-bg) 82%, white 5%);
                    cursor: pointer;
                }
                .track::after {
                    content: "";
                    position: absolute;
                    top: 3px;
                    left: 3px;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: var(--settings-muted);
                    transition: transform .16s ease, background .16s ease;
                }
                .switch input:checked + .track::after { transform: translateX(20px); background: var(--settings-accent-light); }
                .switch input:focus-visible + .track { outline: 2px solid var(--settings-accent-light); outline-offset: 2px; }
                .actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 22px; }
                .action-group { display: flex; gap: 8px; }
                .action {
                    min-height: 38px;
                    padding: 8px 14px;
                    border: 1px solid color-mix(in srgb, var(--settings-accent) 30%, transparent);
                    border-radius: 10px;
                    background: transparent;
                    color: var(--settings-text);
                    cursor: pointer;
                }
                .action:hover, .action:focus-visible { border-color: var(--settings-accent-light); outline: none; }
                .primary { border-color: var(--settings-accent); background: var(--settings-accent); color: var(--settings-bg); font-weight: 750; }
                .reset { color: var(--settings-muted); }
                @media (max-width: 700px) {
                    :host { right: 12px; bottom: 86px; }
                    .backdrop { padding: 10px; }
                    .panel { max-height: calc(100vh - 20px); border-radius: 16px; }
                    .presets, .colors, .sigils { grid-template-columns: 1fr; }
                    .header { padding: 18px 18px 12px; }
                    form { padding: 16px 18px 18px; }
                    .actions { align-items: stretch; flex-direction: column; }
                    .action-group { display: grid; grid-template-columns: 1fr 1fr; }
                    .reset { width: 100%; }
                }
                /* ---- Reverie appearance panel ---- */
                :host { --settings-display-font: "Palatino Linotype", Palatino, "Book Antiqua", "Iowan Old Style", Georgia, serif; }
                .launcher {
                    background:
                        radial-gradient(circle at 30% 28%, color-mix(in srgb, var(--settings-accent) 30%, transparent), transparent 58%),
                        color-mix(in srgb, var(--settings-panel) 74%, transparent);
                    animation: reverie-breathe 5.5s ease-in-out infinite;
                }
                @keyframes reverie-breathe {
                    0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,.42), 0 0 0 0 color-mix(in srgb, var(--settings-accent) 34%, transparent); }
                    50% { box-shadow: 0 10px 30px rgba(0,0,0,.42), 0 0 0 10px color-mix(in srgb, var(--settings-accent) 0%, transparent), 0 0 28px color-mix(in srgb, var(--settings-accent) 46%, transparent); }
                }
                .backdrop { background: color-mix(in srgb, var(--settings-bg) 52%, transparent); backdrop-filter: blur(14px) saturate(1.2); }
                .panel {
                    border-color: color-mix(in srgb, var(--settings-accent) 30%, transparent);
                    border-radius: 24px;
                    background: linear-gradient(160deg, color-mix(in srgb, var(--settings-panel) 84%, transparent), color-mix(in srgb, var(--settings-bg) 90%, transparent));
                    backdrop-filter: blur(28px) saturate(1.3);
                    box-shadow: 0 30px 90px rgba(0,0,0,.55), inset 0 1px 0 color-mix(in srgb, var(--settings-accent-light) 14%, transparent);
                }
                h2 { font: 500 1.35rem/1.2 var(--settings-display-font); letter-spacing: .02em; }
                legend { font-size: .62rem; font-weight: 600; letter-spacing: .26em; }
                .preset-face, .color-row, .select-row, .sigil-row, .custom-palette, .speaker-details {
                    border-radius: 14px;
                    background: color-mix(in srgb, var(--settings-panel) 48%, transparent);
                }
                .preset-card input:checked + .preset-face {
                    box-shadow: 0 0 0 1px var(--settings-accent), 0 0 26px color-mix(in srgb, var(--settings-accent) 24%, transparent);
                }
                .preset-name { font-family: var(--settings-display-font); font-size: .95rem; font-weight: 500; letter-spacing: .02em; }
                select, .speaker-name-input, .sigil-input { border-radius: 10px; background: color-mix(in srgb, var(--settings-bg) 70%, transparent); }
                .select-row + .toggle-row { margin-top: 12px; }
                .action { border-radius: 999px; }
                .primary { background: linear-gradient(135deg, var(--settings-accent-light), var(--settings-accent)); }
                .track { background: color-mix(in srgb, var(--settings-bg) 60%, transparent); }
                .switch input:checked + .track { border-color: var(--settings-accent); background: color-mix(in srgb, var(--settings-accent) 22%, transparent); }
                @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
            </style>
            <button class="launcher" type="button" aria-label="Open Saevyn appearance settings" title="Saevyn appearance settings"><span class="launcher-glyph" aria-hidden="true">⚙</span></button>
            <div class="backdrop" hidden>
                <section class="panel" role="dialog" aria-modal="true" aria-labelledby="saevyn-settings-title">
                    <header class="header">
                        <div><h2 id="saevyn-settings-title">Saevyn Reverie</h2><p class="subtitle">Changes preview live and stay in this browser.</p></div>
                        <button class="close" type="button" aria-label="Close settings">×</button>
                    </header>
                    <form>
                        <fieldset>
                            <legend>Theme</legend>
                            <div class="presets" role="radiogroup" aria-label="Theme preset"></div>
                            <input name="background" type="hidden">
                            <input name="surface" type="hidden">
                            <input name="accent" type="hidden">
                            <input name="text" type="hidden">
                        </fieldset>
                        <fieldset>
                            <legend>Typography</legend>
                            <div class="fonts">
                                <label class="select-row">Interface
                                    <select name="uiFont"><option value="system">System</option><option value="display">Dreaming serif</option><option value="serif">Classic serif</option><option value="humanist">Humanist</option><option value="rounded">Rounded</option><option value="mono">Monospace</option></select>
                                </label>
                                <label class="select-row">Messages
                                    <select name="messageFont"><option value="display">Dreaming serif</option><option value="serif">Classic serif</option><option value="system">System</option><option value="humanist">Humanist</option><option value="rounded">Rounded</option><option value="mono">Monospace</option></select>
                                </label>
                            </div>
                        </fieldset>
                        <fieldset>
                            <legend>Conversation</legend>
                            <div class="toggle-row">
                                <div class="toggle-copy"><strong>Speaker separation</strong><span>Show sigil dividers when a configured speaker prefix appears.</span></div>
                                <label class="switch"><input name="speakerSeparation" type="checkbox"><span class="track"></span></label>
                            </div>
                        </fieldset>
                        <fieldset>
                            <legend>Ornament</legend>
                            <label class="select-row">Look
                                <select name="look"><option value="reverie">Reverie</option><option value="cathedral">Cathedral Glass</option><option value="nouveau">Art Nouveau</option><option value="tidepool">Tidepool</option></select>
                            </label>
                            <label class="select-row">Ornament density
                                <select name="ornamentDensity"><option value="quiet">Quiet</option><option value="filigree">Filigree</option><option value="opulent">Opulent</option></select>
                            </label>
                            <label class="select-row">Glow
                                <select name="glowLevel"><option value="none">None</option><option value="soft">Soft</option><option value="bright">Bright</option></select>
                            </label>
                            <div class="toggle-row">
                                <div class="toggle-copy"><strong>Living light</strong><span>The lantern quickens while you type and flares on send; new speakers arrive with a sweep of light.</span></div>
                                <label class="switch"><input name="livingLight" type="checkbox"><span class="track"></span></label>
                            </div>
                        </fieldset>
                        <fieldset>
                            <legend>Atmosphere</legend>
                            <label class="select-row">Speaker dividers
                                <select name="ornamentStyle"><option value="hairline">Hairline &amp; sigil</option></select>
                            </label>
                            <div class="toggle-row">
                                <div class="toggle-copy"><strong>Drifting aurora</strong><span>Let the sky, stars, halos, and the composer ring move slowly. Off keeps every light still.</span></div>
                                <label class="switch"><input name="motion" type="checkbox"><span class="track"></span></label>
                            </div>
                            <div class="toggle-row">
                                <div class="toggle-copy"><strong>Velvet grain</strong><span>A fine film texture over the room so dark gradients never band.</span></div>
                                <label class="switch"><input name="grain" type="checkbox"><span class="track"></span></label>
                            </div>
                            <div class="toggle-row">
                                <div class="toggle-copy"><strong>Tint ornaments to accent</strong><span>Recolor the gold dividers and emblems to the active theme. Covenant keeps its original gold.</span></div>
                                <label class="switch"><input name="ornamentTint" type="checkbox"><span class="track"></span></label>
                            </div>
                        </fieldset>
                        <details class="speaker-details">
                            <summary><div><strong>Speaker detection</strong><span class="speaker-count">Speakers configured</span></div></summary>
                            <div class="speaker-details-body">
                                <p class="sigil-help">Choose each visible name and the emoji or symbol that must begin a rendered paragraph or block.</p>
                                <div class="sigils"></div>
                                <button class="add-speaker" type="button">＋ Add speaker</button>
                                <p class="name-error field-error" role="alert" hidden></p>
                                <p class="sigil-error field-error" role="alert" hidden></p>
                            </div>
                        </details>
                        <div class="actions">
                            <button class="action reset" type="button">Reset defaults</button>
                            <div class="action-group"><button class="action cancel" type="button">Cancel</button><button class="action primary" type="submit">Save</button></div>
                        </div>
                    </form>
                </section>
            </div>`;

        const presetList = shadow.querySelector(".presets");
        for (const [presetId, preset] of Object.entries(COMMUNITY_THEME_PRESETS)) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            const face = document.createElement("span");
            const top = document.createElement("span");
            const name = document.createElement("span");
            const swatches = document.createElement("span");
            const description = document.createElement("span");
            label.className = "preset-card";
            input.type = "radio";
            input.name = "themePreset";
            input.value = presetId;
            face.className = "preset-face";
            top.className = "preset-top";
            name.className = "preset-name";
            name.textContent = preset.name;
            swatches.className = "preset-swatches";
            swatches.setAttribute("aria-hidden", "true");
            for (const color of [preset.background, preset.surface, preset.secondary, preset.accent, preset.aurora, preset.warmLight, preset.text].filter(Boolean)) {
                const swatch = document.createElement("span");
                swatch.className = "preset-swatch";
                swatch.style.background = color;
                swatches.append(swatch);
            }
            description.className = "preset-description";
            description.textContent = preset.description;
            top.append(name, swatches);
            face.append(top, description);
            label.append(input, face);
            presetList.append(label);
        }
        const customPresetInput = document.createElement("input");
        customPresetInput.type = "radio";
        customPresetInput.name = "themePreset";
        customPresetInput.value = "custom";
        customPresetInput.hidden = true;
        presetList.after(customPresetInput);

        const sigilList = shadow.querySelector(".sigils");
        document.body.append(communitySettingsHost);
        const launcher = shadow.querySelector(".launcher");
        const backdrop = shadow.querySelector(".backdrop");
        const form = shadow.querySelector("form");
        let colorPreviewRequest = 0;

        const cancelColorPreview = () => {
            if (!colorPreviewRequest) return;
            cancelAnimationFrame(colorPreviewRequest);
            colorPreviewRequest = 0;
        };

        const queueColorPreview = () => {
            if (colorPreviewRequest) return;
            colorPreviewRequest = requestAnimationFrame(() => {
                colorPreviewRequest = 0;
                applyCommunitySettings(readCommunitySettingsForm(shadow), { syncSpeakers: false });
            });
        };

        const closePanel = restore => {
            cancelColorPreview();
            if (restore) applyCommunitySettings(communitySettings);
            backdrop.hidden = true;
            launcher.focus();
        };
        const openPanel = () => {
            fillCommunitySettingsForm(shadow, communitySettings);
            validateCommunitySpeakerSettings(shadow);
            backdrop.hidden = false;
            shadow.querySelector('[name="background"]').focus();
        };

        launcher.addEventListener("click", openPanel);
        shadow.querySelector(".add-speaker").addEventListener("click", () => {
            const active = new Set(Array.from(shadow.querySelectorAll("[data-speaker-row]"), row => row.dataset.speakerRow));
            const speakerId = Object.keys(SAEVYN_CONFIG.speakers).find(candidate => !active.has(candidate));
            if (!speakerId) return;
            const row = appendCommunitySpeakerRow(shadow, speakerId, communitySettings);
            row?.querySelector("[data-speaker-name]")?.focus();
            if (validateCommunitySpeakerSettings(shadow)) applyCommunitySettings(readCommunitySettingsForm(shadow));
        });
        shadow.querySelector(".sigils").addEventListener("click", event => {
            const button = event.target.closest("[data-remove-speaker]");
            if (!button) return;
            button.closest("[data-speaker-row]")?.remove();
            updateCommunitySpeakerControls(shadow);
            if (validateCommunitySpeakerSettings(shadow)) applyCommunitySettings(readCommunitySettingsForm(shadow));
        });
        shadow.querySelector(".close").addEventListener("click", () => closePanel(true));
        shadow.querySelector(".cancel").addEventListener("click", () => closePanel(true));
        shadow.querySelector(".reset").addEventListener("click", () => {
            cancelColorPreview();
            fillCommunitySettingsForm(shadow, COMMUNITY_DEFAULT_SETTINGS);
            validateCommunitySpeakerSettings(shadow);
            applyCommunitySettings(COMMUNITY_DEFAULT_SETTINGS);
        });
        backdrop.addEventListener("pointerdown", event => {
            if (event.target === backdrop) closePanel(true);
        });
        form.addEventListener("input", event => {
            if (validateCommunitySpeakerSettings(shadow)) {
                if (event.target.matches('[name="themePreset"]')) {
                    const preset = COMMUNITY_THEME_PRESETS[event.target.value];
                    if (preset) {
                        for (const name of ["background", "surface", "accent", "text"]) {
                            shadow.querySelector(`[name="${name}"]`).value = preset[name];
                        }
                    }
                    queueColorPreview();
                } else if (event.target.matches('input[type="color"]')) {
                    shadow.querySelector('[name="themePreset"][value="custom"]').checked = true;
                    queueColorPreview();
                } else {
                    cancelColorPreview();
                    applyCommunitySettings(readCommunitySettingsForm(shadow));
                }
            }
        });
        form.addEventListener("submit", event => {
            event.preventDefault();
            cancelColorPreview();
            if (!validateCommunitySpeakerSettings(shadow)) {
                form.reportValidity();
                return;
            }
            persistCommunitySettings(readCommunitySettingsForm(shadow));
            closePanel(false);
        });
        shadow.addEventListener("keydown", event => {
            if (event.key === "Escape" && !backdrop.hidden) {
                event.preventDefault();
                closePanel(true);
            }
        });

        applyCommunitySettings(communitySettings);
    }

    function applyThemeConfiguration() {
        const root = document.documentElement;
        const background = SAEVYN_CONFIG.background;
        const hasImage = background.enabled && String(background.image ?? "").trim();

        root.dataset.saevynEnabled = "true";
        root.dataset.saevynTheme = SAEVYN_CONFIG.theme;
        root.dataset.saevynVersion = SAEVYN_VERSION;
        root.dataset.saevynEdition = SAEVYN_EDITION;
        root.classList.add("saevyn-root");
        document.body.classList.add("saevyn-active");

        root.style.setProperty(
            "--saevyn-background-image",
            hasImage ? safeCssUrl(background.image) : "none"
        );
        root.style.setProperty(
            "--saevyn-background-opacity",
            String(clampNumber(background.imageOpacity, 0, 1, 0.22))
        );
        root.style.setProperty(
            "--saevyn-overlay-opacity",
            String(clampNumber(background.overlayOpacity, 0, 1, 0.78))
        );
        root.style.setProperty(
            "--saevyn-background-blur",
            `${clampNumber(background.blur, 0, 24, 0)}px`
        );
        applyCommunitySettings(communitySettings || COMMUNITY_DEFAULT_SETTINGS);
    }

    const IDENTITY_THEME_LITERALS = new Set(
        Object.values(SPEAKER_COLORS).flatMap(({ accent, soft }) => [accent.toLowerCase(), soft.toLowerCase()])
    );
    const FUNCTIONAL_THEME_LITERALS = new Set([
        "#9a2945",
        "#681a34",
        "#fff1ed",
        "rgba(239, 141, 153, 0.42)",
        "rgba(255, 202, 184, 0.15)",
        "rgba(255, 232, 207, 0.13)",
        "rgba(62, 8, 26, 0.34)"
    ]);

    function semanticThemeLiteral(red, green, blue, alpha = 1, source = "") {
        const normalizedSource = source.toLowerCase();
        if (IDENTITY_THEME_LITERALS.has(normalizedSource) || FUNCTIONAL_THEME_LITERALS.has(normalizedSource)) {
            return source;
        }

        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const spread = maximum - minimum;
        const opacity = clampNumber(alpha, 0, 1, 1);
        let token = "";

        // True neutral black remains a shadow rather than becoming theme paint.
        if (maximum <= 8 && spread <= 4) return source;

        const isWarmHighlight = red >= 170 && green >= 105 && red > blue * 1.18;
        const isSoftText = minimum >= 145 && spread <= 56;
        const isLegacyWine = red >= 36 && red > green * 1.28 && red >= blue * 1.04;
        const isLegacyPlum = red >= 45 && blue > green * 1.22 && red > green * 1.30;
        const isDarkSurface = maximum <= 78;

        if (isWarmHighlight) {
            token = maximum >= 225 ? "--saevyn-gold-light" : "--saevyn-gold";
        } else if (isSoftText) {
            token = maximum >= 220 ? "--saevyn-text" : "--saevyn-muted";
        } else if (isLegacyWine || isLegacyPlum) {
            // Wine/plum literals describe the shell's surface hierarchy. They
            // are not accent paint: mapping them to gold made navigation pills,
            // sidebar rows, and the profile strip turn muddy brass in Covenant.
            // Keeping them on the panel token preserves the original wine-black
            // hierarchy and lets alternate themes substitute their own surface.
            // Translucent wine/plum literals are atmosphere rather than
            // surface: the radial glows behind panels, sidebar, composer, and
            // menus. Routing them through the glow token restores the
            // saturated plum the original stylesheet painted and lets every
            // theme glow in its own hue instead of a slightly paler surface.
            const isAtmosphere = opacity <= 0.6 && maximum >= 60;
            token = isAtmosphere
                ? "--saevyn-glow"
                : maximum <= 32
                    ? "--saevyn-panel-subtle"
                    : maximum <= 86
                        ? "--saevyn-panel"
                        : "--saevyn-panel-selected";
        } else if (isDarkSurface) {
            token = maximum <= 20 ? "--saevyn-bg" : "--saevyn-panel";
        } else {
            return source;
        }

        if (opacity >= 0.995) return `var(${token})`;
        const percentage = Math.max(1, Math.round(opacity * 10000) / 100);
        return `color-mix(in srgb, var(${token}) ${percentage}%, transparent)`;
    }

    function semanticizeLegacyThemeCss(css) {
        // Protect only the primitive Saevyn variables from self-reference.
        // Native ChatGPT aliases declared later in the same root block must be
        // semanticized as well or they retain the original burgundy/gold skin.
        const primitiveMarker = "--saevyn-accent-wash-strong";
        const primitiveIndex = css.indexOf(primitiveMarker);
        const primitiveEnd = primitiveIndex >= 0 ? css.indexOf(";", primitiveIndex) + 1 : 0;
        const protectedRoot = primitiveEnd > 0 ? css.slice(0, primitiveEnd) : "";
        let themedCss = primitiveEnd > 0 ? css.slice(primitiveEnd) : css;

        themedCss = themedCss.replace(/#[0-9a-f]{6}/gi, source => {
            const red = Number.parseInt(source.slice(1, 3), 16);
            const green = Number.parseInt(source.slice(3, 5), 16);
            const blue = Number.parseInt(source.slice(5, 7), 16);
            return semanticThemeLiteral(red, green, blue, 1, source);
        });
        themedCss = themedCss.replace(
            /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)/gi,
            (source, red, green, blue, alpha) => semanticThemeLiteral(
                Number(red),
                Number(green),
                Number(blue),
                alpha === undefined ? 1 : Number(alpha),
                source
            )
        );

        return protectedRoot + themedCss;
    }


    const REVERIE_CSS = "/* =====================================================================\n   Saevyn Reverie — the dreaming layer.\n   Appended after the compiled Covenant stylesheet. It only reads the\n   semantic tokens (--saevyn-*) so every preset and custom palette flows\n   through it. No literal wine or gold lives here.\n   ===================================================================== */\n\n@property --saevyn-angle {\n    syntax: \"<angle>\";\n    inherits: false;\n    initial-value: 0deg;\n}\n\n@keyframes reverie-ring { to { --saevyn-angle: 360deg; } }\n@keyframes reverie-drift-a {\n    0%   { transform: translate3d(0, 0, 0) scale(1); }\n    50%  { transform: translate3d(3vw, 2vh, 0) scale(1.035); }\n    100% { transform: translate3d(-2vw, 3vh, 0) scale(0.985); }\n}\n@keyframes reverie-drift-b {\n    0%   { transform: translate3d(0, 0, 0) scale(1); }\n    50%  { transform: translate3d(-3vw, 2.5vh, 0) scale(1.025); }\n    100% { transform: translate3d(2vw, -2vh, 0) scale(1.04); }\n}\n@keyframes reverie-drift-c {\n    0%   { transform: translate3d(0, 0, 0) scale(1); }\n    50%  { transform: translate3d(2.5vw, -2vh, 0) scale(1.04); }\n    100% { transform: translate3d(-3vw, 1vh, 0) scale(0.985); }\n}\n@keyframes reverie-stars-far { to { transform: translate3d(-260px, 140px, 0); } }\n@keyframes reverie-twinkle {\n    0%, 100% { opacity: 0.32; }\n    50%      { opacity: 0.78; }\n}\n@keyframes reverie-rise {\n    from { opacity: 0; transform: translateY(6px); }\n    to   { opacity: 1; transform: none; }\n}\n@keyframes reverie-fade {\n    from { opacity: 0; }\n    to   { opacity: 1; }\n}\n\nhtml.saevyn-root {\n    --reverie-glass: color-mix(in srgb, var(--saevyn-panel) 58%, transparent);\n    --reverie-glass-strong: color-mix(in srgb, var(--saevyn-panel) 80%, transparent);\n    --reverie-hairline: color-mix(in srgb, var(--saevyn-gold) 22%, transparent);\n    --reverie-hairline-strong: color-mix(in srgb, var(--saevyn-gold) 46%, transparent);\n    --reverie-blur: 22px;\n    --reverie-radius: 18px;\n    --reverie-display-font: \"Palatino Linotype\", Palatino, \"Book Antiqua\", \"Iowan Old Style\", Georgia, serif;\n    /* Glow system. These are the \"none\" values; Ornament → Glow raises them. */\n    --reverie-halo: 0;\n    --reverie-portrait-glow: 0%;\n    --reverie-name-glow: 0%;\n    --reverie-sigil-glow: 0%;\n    --reverie-emblem-glow: 0;\n    --reverie-flourish-glow: 0%;\n    --reverie-laurel: 0.3;\n    --reverie-weather: 0.2;\n    --reverie-candle: 0.35;\n}\nhtml[data-saevyn-glow=\"soft\"] {\n    --reverie-candle: 0.55;\n    --reverie-halo: 0.36;\n    --reverie-portrait-glow: 18%;\n    --reverie-name-glow: 16%;\n    --reverie-sigil-glow: 0%;\n    --reverie-emblem-glow: 0.4;\n    --reverie-flourish-glow: 28%;\n    --reverie-laurel: 0.28;\n    --reverie-weather: 0.34;\n}\nhtml[data-saevyn-glow=\"bright\"] {\n    --reverie-candle: 0.8;\n    --reverie-halo: 0.7;\n    --reverie-portrait-glow: 42%;\n    --reverie-name-glow: 40%;\n    --reverie-sigil-glow: 70%;\n    --reverie-emblem-glow: 1;\n    --reverie-flourish-glow: 55%;\n    --reverie-laurel: 0.5;\n    --reverie-weather: 0.55;\n}\n\n/* ---------- The sky ---------- */\n\nbody.saevyn-active::after {\n    background:\n        radial-gradient(ellipse 92% 82% at 50% 44%, transparent 52%, color-mix(in srgb, var(--saevyn-bg) 78%, transparent) 100%) !important;\n}\n\n#saevyn-reverie-sky {\n    position: fixed;\n    inset: 0;\n    z-index: -1;\n    overflow: hidden;\n    pointer-events: none;\n    contain: strict;\n}\nbody:not(.saevyn-active) #saevyn-reverie-sky { display: none; }\n\n#saevyn-reverie-sky .orb {\n    position: absolute;\n    display: block;\n    border-radius: 50%;\n    filter: blur(110px);\n    opacity: 1;\n    will-change: transform;\n}\n#saevyn-reverie-sky .orb-1 {\n    width: 108vmax; height: 86vmax; left: -58vmax; top: -48vmax;\n    background: radial-gradient(ellipse,\n        color-mix(in oklab, var(--saevyn-glow) 34%, transparent) 0%,\n        color-mix(in oklab, var(--saevyn-secondary, var(--saevyn-glow)) 18%, transparent) 34%,\n        color-mix(in oklab, var(--saevyn-glow) 7%, transparent) 64%,\n        transparent 88%);\n    animation: reverie-drift-a 88s ease-in-out infinite alternate;\n}\n#saevyn-reverie-sky .orb-2 {\n    width: 96vmax; height: 112vmax; right: -58vmax; top: -28vmax;\n    background: radial-gradient(ellipse,\n        color-mix(in oklab, var(--saevyn-aurora) 22%, transparent) 0%,\n        color-mix(in oklab, var(--saevyn-secondary, var(--saevyn-aurora)) 11%, transparent) 38%,\n        color-mix(in oklab, var(--saevyn-aurora) 4%, transparent) 68%,\n        transparent 90%);\n    animation: reverie-drift-b 104s ease-in-out infinite alternate;\n}\n#saevyn-reverie-sky .orb-3 {\n    width: 124vmax; height: 68vmax; left: -12vmax; bottom: -54vmax;\n    background: radial-gradient(ellipse,\n        color-mix(in oklab, var(--saevyn-warm, var(--saevyn-gold)) 12%, transparent) 0%,\n        color-mix(in oklab, var(--saevyn-warm, var(--saevyn-gold)) 5%, transparent) 42%,\n        transparent 84%);\n    animation: reverie-drift-c 116s ease-in-out infinite alternate;\n}\n#saevyn-reverie-sky .orb-4 {\n    display: none;\n}\n#saevyn-reverie-sky .stars {\n    position: absolute;\n    inset: -30%;\n    display: block;\n    background-repeat: repeat;\n    will-change: transform, opacity;\n}\n#saevyn-reverie-sky .stars--far {\n    background-image:\n        radial-gradient(1px 1px at 22px 34px,  rgba(255,255,255,0.85), transparent 70%),\n        radial-gradient(1px 1px at 141px 88px, rgba(255,255,255,0.55), transparent 70%),\n        radial-gradient(1px 1px at 208px 21px, rgba(255,255,255,0.7),  transparent 70%),\n        radial-gradient(1px 1px at 63px 172px, rgba(255,255,255,0.5),  transparent 70%),\n        radial-gradient(1px 1px at 251px 201px,rgba(255,255,255,0.8),  transparent 70%),\n        radial-gradient(1px 1px at 177px 243px,rgba(255,255,255,0.45), transparent 70%),\n        radial-gradient(1px 1px at 96px 118px, rgba(255,255,255,0.6),  transparent 70%);\n    background-size: 280px 280px;\n    opacity: 0.42;\n    animation: reverie-stars-far 180s linear infinite;\n}\n#saevyn-reverie-sky .stars--near {\n    background-image:\n        radial-gradient(1.6px 1.6px at 48px 76px,  color-mix(in srgb, var(--saevyn-warm, var(--saevyn-gold-light)) 92%, white), transparent 70%),\n        radial-gradient(1.4px 1.4px at 312px 154px, rgba(255,255,255,0.9), transparent 70%),\n        radial-gradient(1.8px 1.8px at 196px 402px, color-mix(in srgb, var(--saevyn-aurora) 80%, white), transparent 70%),\n        radial-gradient(1.3px 1.3px at 420px 44px,  rgba(255,255,255,0.75), transparent 70%),\n        radial-gradient(1.5px 1.5px at 104px 318px, color-mix(in srgb, var(--saevyn-warm, var(--saevyn-gold-light)) 80%, white), transparent 70%);\n    background-size: 460px 460px;\n    opacity: 0.55;\n    animation: reverie-twinkle 7s ease-in-out infinite;\n}\n#saevyn-reverie-sky .veil {\n    position: absolute;\n    inset: 0;\n    display: block;\n    background:\n        radial-gradient(ellipse 56% 105% at 50% 48%, color-mix(in oklab, var(--saevyn-atmosphere-shadow, var(--saevyn-bg)) 22%, transparent), color-mix(in oklab, var(--saevyn-bg) 5%, transparent) 58%, transparent 100%),\n        linear-gradient(180deg, color-mix(in oklab, var(--saevyn-bg) 42%, transparent), transparent 24%, transparent 72%, color-mix(in oklab, var(--saevyn-bg) 62%, transparent));\n}\n\nhtml[data-saevyn-motion=\"still\"] #saevyn-reverie-sky *,\nhtml[data-saevyn-motion=\"still\"] body.saevyn-active .saevyn-speaker-header::before,\nhtml[data-saevyn-motion=\"still\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before {\n    animation: none !important;\n}\n\n/* ---------- Type ---------- */\n\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown,\nbody.saevyn-active .saevyn-message-body .markdown {\n    font-family: var(--saevyn-message-font, var(--reverie-display-font)) !important;\n    font-size: 1.05rem !important;\n    line-height: 1.78 !important;\n    letter-spacing: 0.004em;\n    color: color-mix(in srgb, var(--saevyn-text) 95%, transparent) !important;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown p { margin-block: 0.5em 1.05em; }\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown em {\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 58%, var(--saevyn-muted));\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown strong {\n    color: var(--saevyn-text);\n    font-weight: 600;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown :is(h1, h2, h3, h4) {\n    font-family: var(--saevyn-message-font, var(--reverie-display-font)) !important;\n    font-weight: 500 !important;\n    letter-spacing: 0.01em;\n    color: color-mix(in srgb, var(--saevyn-gold-light) 55%, var(--saevyn-text)) !important;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown blockquote {\n    margin-inline: 0;\n    padding: 0.1rem 0 0.1rem 1.15rem;\n    border-left: 1px solid color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 62%, transparent) !important;\n    color: var(--saevyn-muted) !important;\n    font-style: italic;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown a {\n    color: color-mix(in srgb, var(--saevyn-gold-light) 78%, white) !important;\n    text-decoration-color: color-mix(in srgb, var(--saevyn-gold) 42%, transparent);\n    text-underline-offset: 0.18em;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown hr {\n    height: 1px;\n    margin: 1.6rem 0;\n    border: 0 !important;\n    background: linear-gradient(90deg, transparent, var(--reverie-hairline-strong), transparent);\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown pre {\n    border: 1px solid var(--reverie-hairline) !important;\n    border-radius: 14px !important;\n    background: color-mix(in srgb, var(--saevyn-bg) 68%, transparent) !important;\n    backdrop-filter: blur(12px);\n    -webkit-backdrop-filter: blur(12px);\n    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--saevyn-gold-light) 8%, transparent);\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown :not(pre) > code {\n    padding: 0.1em 0.42em;\n    border: 1px solid var(--reverie-hairline);\n    border-radius: 7px;\n    background: color-mix(in srgb, var(--saevyn-gold) 8%, transparent) !important;\n    color: color-mix(in srgb, var(--saevyn-gold-light) 70%, var(--saevyn-text)) !important;\n    font-size: 0.88em;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown table {\n    border-collapse: separate !important;\n    border-spacing: 0;\n    border: 1px solid var(--reverie-hairline) !important;\n    border-radius: 12px;\n    overflow: hidden;\n    background: color-mix(in srgb, var(--saevyn-panel) 40%, transparent);\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableContainer\"]:has(table) {\n    box-sizing: border-box;\n    width: 100% !important;\n    max-width: 100% !important;\n    min-width: 0 !important;\n    overflow-x: hidden !important;\n    overflow-y: hidden;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableWrapper\"]:has(> table) {\n    box-sizing: border-box;\n    width: 100% !important;\n    max-width: 100% !important;\n    min-width: 0 !important;\n    margin-inline: 0 !important;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableContainer\"] table {\n    box-sizing: border-box;\n    width: 100% !important;\n    max-width: 100% !important;\n    min-width: 0 !important;\n    table-layout: fixed;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableContainer\"] :is(th, td) {\n    min-width: 0 !important;\n    padding: 12px 16px !important;\n    overflow-wrap: anywhere;\n}\n@media (max-width: 720px) {\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableContainer\"]:has(table) {\n        overflow-x: auto !important;\n    }\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableWrapper\"]:has(> table),\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableContainer\"] table {\n        width: 620px !important;\n        max-width: none !important;\n        min-width: 620px !important;\n    }\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown [class*=\"_tableContainer\"] :is(th, td) {\n        padding: 10px 12px !important;\n    }\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown :is(th, td) {\n    border-color: var(--reverie-hairline) !important;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .markdown th {\n    background: color-mix(in srgb, var(--saevyn-gold) 10%, transparent) !important;\n    font-weight: 600;\n    letter-spacing: 0.04em;\n}\n\nbody.saevyn-active ::selection {\n    background: color-mix(in srgb, var(--saevyn-gold) 36%, transparent);\n    color: var(--saevyn-text);\n}\n\n/* ---------- Scrollbars ---------- */\n\nbody.saevyn-active * {\n    scrollbar-width: thin;\n    scrollbar-color: color-mix(in srgb, var(--saevyn-gold) 28%, transparent) transparent;\n}\nbody.saevyn-active ::-webkit-scrollbar { width: 9px; height: 9px; }\nbody.saevyn-active ::-webkit-scrollbar-track { background: transparent; }\nbody.saevyn-active ::-webkit-scrollbar-thumb {\n    border: 2px solid transparent;\n    border-radius: 999px;\n    background: color-mix(in srgb, var(--saevyn-gold) 28%, transparent);\n    background-clip: padding-box;\n}\nbody.saevyn-active ::-webkit-scrollbar-thumb:hover {\n    background: color-mix(in srgb, var(--saevyn-gold) 48%, transparent);\n    background-clip: padding-box;\n}\n\n/* ---------- Sidebar: frosted glass ---------- */\n\nbody.saevyn-active #stage-slideover-sidebar,\nbody.saevyn-active #stage-popover-sidebar {\n    border-inline-end: 1px solid var(--reverie-hairline) !important;\n    background:\n        radial-gradient(ellipse 105% 58% at 0% 4%,\n            color-mix(in oklab, var(--saevyn-secondary, var(--saevyn-aurora)) 15%, transparent),\n            transparent 72%),\n        radial-gradient(ellipse 82% 52% at 100% 96%,\n            color-mix(in oklab, var(--saevyn-warm, var(--saevyn-gold)) 9%, transparent),\n            transparent 76%),\n        linear-gradient(180deg,\n            color-mix(in srgb, var(--saevyn-sidebar) 70%, transparent),\n            color-mix(in srgb, var(--saevyn-sidebar-deep) 82%, transparent)) !important;\n    backdrop-filter: blur(var(--reverie-blur)) saturate(1.35);\n    -webkit-backdrop-filter: blur(var(--reverie-blur)) saturate(1.35);\n    box-shadow:\n        inset -1px 0 color-mix(in srgb, var(--saevyn-gold-light) 6%, transparent),\n        14px 0 56px color-mix(in srgb, var(--saevyn-bg) 42%, transparent) !important;\n    color: var(--saevyn-text);\n}\nbody.saevyn-active #stage-popover-sidebar::before,\nbody.saevyn-active #stage-slideover-sidebar::before {\n    display: none !important;\n}\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) [class*=\"bg-token-sidebar-surface\"],\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) .sidebar-inner,\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) nav > div:has(#sidebar-header),\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) div:has(> div > [data-testid=\"accounts-profile-button\"]) {\n    background: transparent !important;\n    box-shadow: none !important;\n    border: 0 !important;\n}\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) .sticky,\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) .sticky-new-chat,\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) .sidebar-header-shell,\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) nav > div:has(> ul > li > [data-testid=\"create-new-chat-button\"]) {\n    background: color-mix(in srgb, var(--saevyn-sidebar-deep) 24%, transparent) !important;\n    backdrop-filter: blur(18px);\n    -webkit-backdrop-filter: blur(18px);\n    box-shadow: none !important;\n    border: 0 !important;\n}\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2 {\n    margin: 1.3rem 0.65rem 0.45rem !important;\n    color: color-mix(in srgb, var(--saevyn-gold) 72%, var(--saevyn-muted)) !important;\n    font-family: var(--saevyn-ui-font) !important;\n    font-size: 0.62rem !important;\n    font-weight: 600 !important;\n    letter-spacing: 0.28em !important;\n    text-transform: uppercase !important;\n}\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) a[data-sidebar-item=\"true\"]:not(#sidebar-header a) {\n    margin-inline-start: 0 !important;\n    width: 100% !important;\n    border: 1px solid transparent !important;\n    border-radius: 12px !important;\n    background: transparent !important;\n    box-shadow: none !important;\n    color: color-mix(in srgb, var(--saevyn-text) 82%, transparent) !important;\n    transition: background 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease;\n}\nbody.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) a[data-sidebar-item=\"true\"]:not(#sidebar-header a):is(:hover, :focus-visible) {\n    border-color: var(--reverie-hairline) !important;\n    background: color-mix(in srgb, var(--saevyn-gold) 9%, transparent) !important;\n    color: var(--saevyn-text) !important;\n    transform: translateX(2px);\n}\nbody.saevyn-active #stage-popover-sidebar [data-testid=\"create-new-chat-button\"],\nbody.saevyn-active #stage-slideover-sidebar [data-testid=\"create-new-chat-button\"] {\n    border: 1px solid var(--reverie-hairline-strong) !important;\n    border-radius: 999px !important;\n    background: linear-gradient(90deg,\n        color-mix(in srgb, var(--saevyn-secondary, var(--saevyn-aurora)) 15%, transparent),\n        color-mix(in srgb, var(--saevyn-gold) 11%, transparent),\n        color-mix(in srgb, var(--saevyn-warm, var(--saevyn-gold)) 8%, transparent)) !important;\n    box-shadow: 0 0 22px color-mix(in srgb, var(--saevyn-glow) 26%, transparent) !important;\n}\nbody.saevyn-active #stage-popover-sidebar [data-testid=\"create-new-chat-button\"]::after,\nbody.saevyn-active #stage-slideover-sidebar [data-testid=\"create-new-chat-button\"]::after {\n    display: none !important;\n}\nbody.saevyn-active #sidebar-header a[data-sidebar-item=\"true\"][href=\"/\"] .header-wordmark {\n    font-family: var(--reverie-display-font) !important;\n    font-weight: 500 !important;\n    letter-spacing: 0.12em !important;\n    text-transform: uppercase;\n    font-size: 0.78rem !important;\n    color: color-mix(in srgb, var(--saevyn-gold-light) 75%, var(--saevyn-text)) !important;\n}\nbody.saevyn-active [data-testid=\"accounts-profile-button\"] {\n    border: 1px solid transparent !important;\n    border-radius: 14px !important;\n    background: color-mix(in srgb, var(--saevyn-panel) 42%, transparent) !important;\n    box-shadow: none !important;\n}\nbody.saevyn-active [data-testid=\"accounts-profile-button\"]:is(:hover, :focus-visible, [data-state=\"open\"]) {\n    border-color: var(--reverie-hairline) !important;\n    background: color-mix(in srgb, var(--saevyn-gold) 10%, transparent) !important;\n}\n\n/* ---------- Top bar ---------- */\n\nbody.saevyn-active #page-header,\nbody.saevyn-active header.sticky {\n    border: 0 !important;\n    background: linear-gradient(180deg, color-mix(in srgb, var(--saevyn-bg) 72%, transparent), transparent) !important;\n    backdrop-filter: blur(10px);\n    -webkit-backdrop-filter: blur(10px);\n    box-shadow: none !important;\n}\nbody.saevyn-active #page-header :is(button, a) {\n    border-radius: 12px !important;\n    border-color: transparent !important;\n    background: transparent !important;\n    box-shadow: none !important;\n}\nbody.saevyn-active #page-header :is(button, a):is(:hover, :focus-visible) {\n    border-color: var(--reverie-hairline) !important;\n    background: color-mix(in srgb, var(--saevyn-gold) 9%, transparent) !important;\n}\n\n/* ---------- Menus, popovers, dialogs: glass ---------- */\n\nbody.saevyn-active [role=\"menu\"][data-radix-menu-content],\nbody.saevyn-active .popover.shadow-short-composer:has(.__menu-item),\nbody.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]),\nbody.saevyn-active [data-testid=\"modal-global-search\"] > .popover,\nbody.saevyn-active [data-testid^=\"modal-\"] [role=\"dialog\"].popover,\nbody.saevyn-active dialog > [data-testid^=\"modal-\"],\nbody.saevyn-active [role=\"dialog\"]:has(input[aria-label=\"Search settings\"]) {\n    border: 1px solid var(--reverie-hairline-strong) !important;\n    border-radius: var(--reverie-radius) !important;\n    background:\n        linear-gradient(160deg,\n            color-mix(in srgb, var(--saevyn-panel) 80%, transparent),\n            color-mix(in srgb, var(--saevyn-bg) 86%, transparent)) !important;\n    backdrop-filter: blur(28px) saturate(1.3);\n    -webkit-backdrop-filter: blur(28px) saturate(1.3);\n    box-shadow:\n        0 30px 90px color-mix(in srgb, var(--saevyn-bg) 62%, transparent),\n        inset 0 1px 0 color-mix(in srgb, var(--saevyn-gold-light) 12%, transparent) !important;\n    /* Floating menus use an inline transform for collision-aware placement.\n       Fade without replacing that native transform. */\n    animation: reverie-fade 220ms ease-out both;\n}\nbody.saevyn-active [role=\"dialog\"]:has(input[aria-label=\"Search settings\"]) {\n    border-radius: 22px !important;\n}\nbody.saevyn-active [role=\"menu\"][data-radix-menu-content] [role=\"menuitem\"],\nbody.saevyn-active .popover.shadow-short-composer:has(.__menu-item) .__menu-item,\nbody.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]) [role=\"option\"] {\n    border-radius: 10px !important;\n}\nbody.saevyn-active [role=\"menu\"][data-radix-menu-content] [role=\"menuitem\"]:is(:hover, :focus-visible, [data-highlighted]),\nbody.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]) [role=\"option\"]:is(:hover, [data-highlighted]) {\n    background: color-mix(in srgb, var(--saevyn-gold) 11%, transparent) !important;\n}\nbody.saevyn-active [data-testid^=\"modal-\"] > .fixed.inset-0::before,\nbody.saevyn-active dialog:has(> [data-testid^=\"modal-\"])::backdrop,\nbody.saevyn-active .modal-settings-layer::before {\n    background: color-mix(in srgb, var(--saevyn-bg) 58%, transparent) !important;\n    backdrop-filter: blur(10px) !important;\n    -webkit-backdrop-filter: blur(10px) !important;\n}\n\n/* Pills, tabs, primary actions */\nbody.saevyn-active :is([role=\"tablist\"], [role=\"radiogroup\"]) {\n    border: 1px solid var(--reverie-hairline) !important;\n    border-radius: 999px !important;\n    background: color-mix(in srgb, var(--saevyn-panel) 46%, transparent) !important;\n    backdrop-filter: blur(12px);\n    -webkit-backdrop-filter: blur(12px);\n}\nbody.saevyn-active :is([role=\"tab\"], [role=\"radio\"]) {\n    border-radius: 999px !important;\n}\nbody.saevyn-active [role=\"tablist\"][aria-label=\"Settings\"] {\n    border: 0 !important;\n    border-radius: 0 !important;\n    background: transparent !important;\n    backdrop-filter: none;\n    -webkit-backdrop-filter: none;\n}\nbody.saevyn-active [role=\"tablist\"][aria-label=\"Settings\"] [role=\"tab\"] {\n    border-radius: 12px !important;\n}\nbody.saevyn-active .btn-primary:not(:disabled),\nbody.saevyn-active .interactive-button-primary:not(:disabled) {\n    border: 0 !important;\n    border-radius: 999px !important;\n    background: linear-gradient(135deg, var(--saevyn-gold-light), var(--saevyn-gold)) !important;\n    color: var(--saevyn-accent-ink) !important;\n    box-shadow: 0 0 22px color-mix(in srgb, var(--saevyn-gold) 38%, transparent), inset 0 1px 0 rgba(255,255,255,0.25) !important;\n}\nbody.saevyn-active .btn-secondary {\n    border: 1px solid var(--reverie-hairline-strong) !important;\n    border-radius: 999px !important;\n    background: color-mix(in srgb, var(--saevyn-panel) 50%, transparent) !important;\n}\nbody.saevyn-active .wm-app-scrollToBottomButton {\n    border: 1px solid var(--reverie-hairline-strong) !important;\n    border-radius: 50% !important;\n    background: var(--reverie-glass-strong) !important;\n    backdrop-filter: blur(14px);\n    -webkit-backdrop-filter: blur(14px);\n    box-shadow: 0 0 24px color-mix(in srgb, var(--saevyn-glow) 34%, transparent) !important;\n}\n\n/* ---------- Composer: the lantern ---------- */\n\n/* ChatGPT gives the footer disclaimer a theme-token shadow. Against Saevyn's\n   transparent shell that becomes a conspicuous black pill, so let the native\n   text sit directly on the atmosphere instead. */\nbody.saevyn-active [class*=\"view-transition-name:var(--vt-disclaimer)\"]\n    [class*=\"shadow-\"][class*=\"--main-surface-primary\"] {\n    background: transparent !important;\n    border-radius: 0 !important;\n    box-shadow: none !important;\n}\n\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n    border: 1px solid color-mix(in srgb, var(--saevyn-gold) 18%, transparent) !important;\n    border-radius: 26px !important;\n    background:\n        radial-gradient(ellipse 54% 150% at 4% 48%,\n            color-mix(in oklab, var(--saevyn-secondary, var(--saevyn-aurora)) 12%, transparent),\n            transparent 72%),\n        radial-gradient(ellipse 46% 140% at 97% 68%,\n            color-mix(in oklab, var(--saevyn-warm, var(--saevyn-gold)) 10%, transparent),\n            transparent 76%),\n        linear-gradient(160deg,\n            color-mix(in srgb, var(--saevyn-panel) 74%, transparent),\n            color-mix(in srgb, var(--saevyn-bg) 80%, transparent)) !important;\n    backdrop-filter: blur(24px) saturate(1.3);\n    -webkit-backdrop-filter: blur(24px) saturate(1.3);\n    box-shadow:\n        inset 0 1px 0 color-mix(in srgb, var(--saevyn-gold-light) 12%, transparent),\n        0 24px 64px color-mix(in srgb, var(--saevyn-bg) 58%, transparent),\n        0 0 48px color-mix(in srgb, var(--saevyn-glow) 22%, transparent) !important;\n    transition: box-shadow 220ms ease, border-color 220ms ease !important;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before {\n    content: \"\";\n    position: absolute;\n    inset: 0;\n    z-index: 0;\n    padding: 1px;\n    border: 0 !important;\n    border-radius: inherit;\n    background: conic-gradient(from var(--saevyn-angle),\n        transparent 0turn,\n        color-mix(in srgb, var(--saevyn-gold-light) 88%, white) 0.12turn,\n        transparent 0.26turn,\n        transparent 0.5turn,\n        color-mix(in srgb, var(--saevyn-secondary, var(--saevyn-aurora)) 82%, white) 0.60turn,\n        transparent 0.71turn,\n        color-mix(in srgb, var(--saevyn-warm, var(--saevyn-gold)) 68%, white) 0.78turn,\n        transparent 0.88turn,\n        transparent 1turn);\n    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n    -webkit-mask-composite: xor;\n    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n    mask-composite: exclude;\n    opacity: 0.85;\n    pointer-events: none;\n    animation: reverie-ring 16s linear infinite;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]:focus-within {\n    border-color: color-mix(in srgb, var(--saevyn-gold) 52%, transparent) !important;\n    box-shadow:\n        inset 0 1px 0 color-mix(in srgb, var(--saevyn-gold-light) 16%, transparent),\n        0 0 0 5px color-mix(in srgb, var(--saevyn-gold) 9%, transparent),\n        0 24px 64px color-mix(in srgb, var(--saevyn-bg) 58%, transparent),\n        0 0 64px color-mix(in srgb, var(--saevyn-glow) 34%, transparent) !important;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] #prompt-textarea {\n    font-family: var(--saevyn-message-font, var(--reverie-display-font)) !important;\n    font-size: 1.04rem !important;\n    line-height: 1.6 !important;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] #prompt-textarea:empty::before,\nbody.saevyn-active form[data-type=\"unified-composer\"] #prompt-textarea [data-placeholder]::before {\n    color: color-mix(in srgb, var(--saevyn-muted) 78%, transparent) !important;\n    font-style: italic;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-composer-grid] button,\nbody.saevyn-active form[data-type=\"unified-composer\"] .composer-btn {\n    border-radius: 999px !important;\n    background: color-mix(in srgb, var(--saevyn-gold) 6%, transparent) !important;\n    border: 1px solid transparent !important;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-composer-grid] button:is(:hover, :focus-visible),\nbody.saevyn-active form[data-type=\"unified-composer\"] .composer-btn:is(:hover, :focus-visible) {\n    border-color: var(--reverie-hairline) !important;\n    background: color-mix(in srgb, var(--saevyn-gold) 12%, transparent) !important;\n}\nbody.saevyn-active form[data-type=\"unified-composer\"] .composer-submit-button-color:not(:disabled),\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-testid=\"send-button\"]:not(:disabled),\nbody.saevyn-active form[data-type=\"unified-composer\"] button[type=\"submit\"]:not(:disabled) {\n    border: 0 !important;\n    background: linear-gradient(135deg, var(--saevyn-gold-light), var(--saevyn-gold)) !important;\n    color: var(--saevyn-accent-ink) !important;\n    box-shadow: 0 0 20px color-mix(in srgb, var(--saevyn-gold) 48%, transparent), inset 0 1px 0 rgba(255,255,255,0.3) !important;\n}\n\n/* ---------- User message: a note in the margin ---------- */\n\nbody.saevyn-active .user-message-bubble-color {\n    border: 1px solid color-mix(in srgb, var(--saevyn-gold) 22%, transparent) !important;\n    border-radius: 22px 22px 6px 22px !important;\n    background:\n        radial-gradient(ellipse 90% 130% at 0% 0%,\n            color-mix(in oklab, var(--saevyn-secondary, var(--saevyn-aurora)) 13%, transparent),\n            transparent 68%),\n        linear-gradient(135deg,\n            color-mix(in srgb, var(--saevyn-warm, var(--saevyn-gold)) 11%, transparent),\n            color-mix(in srgb, var(--saevyn-panel) 58%, transparent)) !important;\n    backdrop-filter: blur(16px);\n    -webkit-backdrop-filter: blur(16px);\n    color: var(--saevyn-text) !important;\n    font-family: var(--saevyn-message-font, var(--reverie-display-font)) !important;\n    font-style: italic;\n    font-size: 1.03rem;\n    line-height: 1.62;\n    box-shadow:\n        inset 0 1px 0 color-mix(in srgb, var(--saevyn-gold-light) 14%, transparent),\n        0 12px 34px color-mix(in srgb, var(--saevyn-bg) 42%, transparent),\n        0 0 26px color-mix(in srgb, var(--saevyn-glow) 18%, transparent) !important;\n}\nbody.saevyn-active .user-message-bubble-color :is(pre, code, kbd) { font-style: normal; }\n\n/* ---------- Speaker headers ---------- */\n\nbody.saevyn-active .saevyn-speaker-header {\n    position: relative;\n    display: grid !important;\n    grid-template-columns: 46px auto minmax(0, 1fr);\n    grid-template-areas: \"portrait name line\";\n    align-items: center;\n    column-gap: 16px;\n    row-gap: 0.55rem;\n    width: 100%;\n    margin: 1.7rem 0 0.95rem;\n    color: var(--saevyn-text);\n    user-select: none;\n    -webkit-user-select: none;\n    animation: reverie-rise 320ms ease-out both;\n}\n\n/* The dividers already carry each speaker's identity through portrait, sigil,\n   tint, and engraving. Keep their field clean: no per-speaker wash behind it. */\nbody.saevyn-active .saevyn-speaker-header::after {\n    display: none !important;\n}\nbody.saevyn-active .saevyn-speaker-header[data-saevyn-segment-index=\"0\"] { margin-top: 0.35rem; }\n\n/* Rotating halo behind the portrait */\nbody.saevyn-active .saevyn-speaker-header::before {\n    content: \"\";\n    position: absolute;\n    top: 23px;\n    left: 23px;\n    z-index: 0;\n    width: 72px;\n    height: 72px;\n    translate: -50% -50%;\n    border-radius: 50%;\n    background: conic-gradient(from var(--saevyn-angle),\n        transparent 0turn,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 62%, transparent) 0.22turn,\n        transparent 0.46turn,\n        color-mix(in srgb, var(--saevyn-aurora) 42%, transparent) 0.72turn,\n        transparent 1turn);\n    filter: blur(11px);\n    opacity: var(--reverie-halo);\n    pointer-events: none;\n    animation: reverie-ring 24s linear infinite;\n}\n\nbody.saevyn-active .saevyn-portrait {\n    position: relative !important;\n    top: auto !important;\n    left: auto !important;\n    z-index: 1;\n    grid-area: portrait;\n    width: 46px !important;\n    height: 46px !important;\n    margin: 0 !important;\n    align-self: center;\n    border: 1px solid color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 72%, transparent);\n    background: color-mix(in srgb, var(--saevyn-bg) 92%, transparent);\n    box-shadow:\n        0 0 0 3px color-mix(in srgb, var(--saevyn-bg) 92%, transparent),\n        0 0 0 4px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 36%, transparent),\n        0 10px 28px color-mix(in srgb, var(--saevyn-bg) 60%, transparent),\n        0 0 30px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) var(--reverie-portrait-glow), transparent);\n}\nhtml[data-saevyn-glow=\"none\"] body.saevyn-active .saevyn-speaker-header::before { display: none; }\nbody.saevyn-active .saevyn-portrait::after {\n    inset: 2px;\n    border-color: color-mix(in srgb, var(--saevyn-gold-light) 22%, transparent);\n}\n\nbody.saevyn-active .saevyn-speaker-header .saevyn-speaker-name,\nbody.saevyn-active .saevyn-speaker-name {\n    grid-area: name;\n    margin: 0 !important;\n    font-family: var(--reverie-display-font) !important;\n    font-size: 0.72rem !important;\n    font-weight: 500 !important;\n    letter-spacing: 0.34em !important;\n    line-height: 1.2;\n    text-align: left !important;\n    text-transform: uppercase;\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 60%, var(--saevyn-text)) !important;\n    text-shadow: 0 0 18px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) var(--reverie-name-glow), transparent);\n    white-space: nowrap;\n}\n\nbody.saevyn-active .saevyn-divider-assembly {\n    grid-area: line;\n    display: flex !important;\n    grid-template-columns: none;\n    align-items: center;\n    gap: 14px;\n    width: 100%;\n    height: auto !important;\n    min-height: 24px;\n    overflow: visible !important;\n}\nbody.saevyn-active .saevyn-divider-assembly::before {\n    content: \"\";\n    flex: 1 1 auto;\n    height: 1px;\n    background: linear-gradient(90deg,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 55%, transparent),\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 18%, transparent) 60%,\n        transparent);\n}\nbody.saevyn-active .saevyn-divider-endpoint,\nbody.saevyn-active .saevyn-divider-rail,\nbody.saevyn-active .saevyn-speaker-emblem,\nbody.saevyn-active .saevyn-speaker-mark::before {\n    display: none !important;\n}\nbody.saevyn-active .saevyn-speaker-mark {\n    position: relative;\n    display: grid !important;\n    place-items: center;\n    width: auto !important;\n    min-width: 28px;\n    height: auto !important;\n    margin: 0 !important;\n    order: 2;\n}\nbody.saevyn-active .saevyn-speaker-mark::after {\n    content: attr(data-saevyn-sigil);\n    font-size: 1.05rem;\n    line-height: 1;\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 85%, white);\n    filter: saturate(0.6) drop-shadow(0 0 9px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) var(--reverie-sigil-glow), transparent));\n    opacity: 0.75;\n}\n\n/* Engraved mode: Community's covenant rails return beneath the name row,\n   softened so they read as moonlit engraving rather than solid brass. */\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header {\n    display: flex !important;\n    flex-direction: column;\n    align-items: stretch;\n    grid-template-columns: none;\n    grid-template-areas: none;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-portrait {\n    position: absolute !important;\n    top: 0 !important;\n    left: -64px !important;\n    width: 50px !important;\n    height: 50px !important;\n    margin: 0 !important;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header::before {\n    top: 25px;\n    left: -39px;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header > :is(.saevyn-laurel, .saevyn-rose, .saevyn-halo) {\n    top: 25px;\n    left: -39px;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-name {\n    display: block;\n    grid-area: auto;\n    margin: -0.22rem 0 0 !important;\n    text-align: center !important;\n}\n/* Hairline mode already carries identity through the portrait, name, and\n   inline message sigil. The extra center medallion only repeats that signal. */\nhtml:not([data-saevyn-ornaments=\"engraved\"]) body.saevyn-active .saevyn-speaker-mark {\n    display: none !important;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-assembly {\n    grid-area: assembly;\n    display: grid !important;\n    grid-template-columns: 63px minmax(0, 1fr) 126px minmax(0, 1fr) 63px;\n    gap: 0;\n    height: 46px !important;\n    overflow: hidden !important;\n    opacity: 0.86;\n    filter: saturate(0.85);\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-assembly::before { display: none; }\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-endpoint,\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-rail,\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-emblem {\n    display: block !important;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark {\n    display: block !important;\n    width: 126px !important;\n    height: 46px !important;\n    order: 0;\n}\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark::after { display: none; }\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark::before { display: block !important; opacity: var(--reverie-emblem-glow); }\n\n/* The thread: a faint accent line that runs from the portrait down the run */\nbody.saevyn-active .saevyn-segment-content {\n    position: relative;\n    margin-inline-start: 62px !important;\n}\nbody.saevyn-active .saevyn-segment-content::before {\n    content: \"\";\n    position: absolute;\n    top: -0.55rem;\n    bottom: -0.55rem;\n    left: -40px;\n    width: 1px;\n    background: linear-gradient(180deg,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 50%, transparent),\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 16%, transparent));\n    pointer-events: none;\n}\nbody.saevyn-active .saevyn-speaker-header + .saevyn-segment-content::before { top: -0.95rem; }\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-segment-content { margin-inline-start: 0 !important; }\nhtml[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-segment-content::before { display: none; }\n\n/* Message action row */\nbody.saevyn-active section[data-turn=\"assistant\"] .message-actions button,\nbody.saevyn-active section[data-turn=\"assistant\"] [data-testid$=\"-turn-action-button\"] {\n    border-radius: 9px !important;\n    color: color-mix(in srgb, var(--saevyn-gold) 70%, var(--saevyn-muted)) !important;\n    transition: background 160ms ease, color 160ms ease;\n}\nbody.saevyn-active section[data-turn=\"assistant\"] .message-actions button:is(:hover, :focus-visible),\nbody.saevyn-active section[data-turn=\"assistant\"] [data-testid$=\"-turn-action-button\"]:is(:hover, :focus-visible) {\n    background: color-mix(in srgb, var(--saevyn-gold) 12%, transparent) !important;\n    color: var(--saevyn-gold-light) !important;\n}\n\n/* ---------- Home: the empty room ---------- */\nbody.saevyn-active header:has([role=\"radiogroup\"][aria-label=\"Select chat surface\"]) {\n    background: transparent !important;\n    border: 0 !important;\n    box-shadow: none !important;\n}\nbody.saevyn-active #main h1 {\n    font-family: var(--reverie-display-font) !important;\n    font-weight: 400 !important;\n    letter-spacing: 0.01em;\n    color: color-mix(in srgb, var(--saevyn-gold-light) 45%, var(--saevyn-text)) !important;\n}\nbody.saevyn-active #main ul:has(> li.group > button) > li > button {\n    border: 1px solid var(--reverie-hairline) !important;\n    border-radius: 16px !important;\n    background: var(--reverie-glass) !important;\n    backdrop-filter: blur(14px);\n    -webkit-backdrop-filter: blur(14px);\n}\n\n/* ---------- Wide screens ---------- */\n@media (min-width: 1100px) {\n    body.saevyn-active .saevyn-portrait {\n        position: relative !important;\n        top: auto !important;\n        left: auto !important;\n        width: 46px !important;\n        height: 46px !important;\n        margin: 0 !important;\n    }\n}\n\n/* ---------- Narrow screens ---------- */\nbody.saevyn-active section[data-turn=\"assistant\"] {\n    container: reverie-turn / inline-size;\n}\n\n/* The sidebar can narrow the thread while the viewport remains wide. */\n@container reverie-turn (max-width: 720px) {\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown,\n    body.saevyn-active .saevyn-message-body .markdown {\n        font-size: 0.94rem !important;\n        line-height: 1.58 !important;\n    }\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown > :is(p, blockquote, ul, ol) {\n        margin-block: 0.72em !important;\n    }\n    body.saevyn-active .saevyn-speaker-header {\n        grid-template-columns: 38px auto minmax(0, 1fr);\n        column-gap: 12px;\n        margin: 1.05rem 0 0.58rem;\n    }\n    body.saevyn-active .saevyn-speaker-header::before { top: 19px; left: 19px; width: 58px; height: 58px; }\n    body.saevyn-active .saevyn-portrait { width: 38px !important; height: 38px !important; }\n    body.saevyn-active .saevyn-speaker-name { font-size: 0.64rem !important; letter-spacing: 0.26em !important; }\n    body.saevyn-active .saevyn-segment-content { margin-inline-start: 0 !important; }\n    body.saevyn-active .saevyn-segment-content::before { display: none; }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-assembly {\n        grid-template-columns: 44px minmax(0, 1fr) 88px minmax(0, 1fr) 44px;\n        height: 34px !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark {\n        width: 88px !important;\n        height: 34px !important;\n    }\n}\n\n@media (max-width: 720px) {\n    #saevyn-reverie-sky .orb { filter: blur(72px); }\n    body.saevyn-active .saevyn-speaker-header {\n        grid-template-columns: 38px auto minmax(0, 1fr);\n        column-gap: 12px;\n        margin: 1.25rem 0 0.7rem;\n    }\n    body.saevyn-active .saevyn-speaker-header::before { top: 19px; left: 19px; width: 58px; height: 58px; }\n    body.saevyn-active .saevyn-portrait {\n        width: 38px !important;\n        height: 38px !important;\n    }\n    body.saevyn-active .saevyn-speaker-name {\n        font-size: 0.64rem !important;\n        letter-spacing: 0.26em !important;\n    }\n    body.saevyn-active .saevyn-segment-content { margin-inline-start: 0 !important; }\n    body.saevyn-active .saevyn-segment-content::before { display: none; }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header {\n        grid-template-columns: none;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-portrait {\n        position: relative !important;\n        top: auto !important;\n        left: auto !important;\n        align-self: center;\n        width: 42px !important;\n        height: 42px !important;\n        margin: 0 0 0.34rem !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header::before {\n        top: 21px;\n        left: 50%;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header > :is(.saevyn-laurel, .saevyn-rose, .saevyn-halo) {\n        top: 21px;\n        left: 50%;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-assembly {\n        grid-template-columns: 54px minmax(0, 1fr) 107px minmax(0, 1fr) 54px;\n        height: 39px !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark {\n        width: 107px !important;\n        height: 39px !important;\n    }\n    body.saevyn-active section[data-turn=\"assistant\"] .markdown,\n    body.saevyn-active .saevyn-message-body .markdown {\n        font-size: 1rem !important;\n        line-height: 1.68 !important;\n    }\n    body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n        border-radius: 22px !important;\n    }\n}\n\n/* Engraved headers need a different composition before ChatGPT reaches its\n   phone breakpoint—especially when the sidebar consumes part of the window.\n   Keep the portrait inside the turn and place the rail beside it instead of\n   stacking a large medallion above every short speaker run. */\n@media (max-width: 1099px) {\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header {\n        display: grid !important;\n        grid-template-columns: 48px minmax(0, 1fr) !important;\n        grid-template-rows: 32px auto;\n        grid-template-areas:\n            \"portrait assembly\"\n            \"portrait name\";\n        align-items: center;\n        column-gap: 12px;\n        row-gap: 0;\n        margin: 0.9rem 0 0.58rem;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-portrait {\n        position: relative !important;\n        top: auto !important;\n        left: auto !important;\n        grid-area: portrait;\n        align-self: center;\n        justify-self: center;\n        width: 42px !important;\n        height: 42px !important;\n        margin: 0 !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header::before {\n        top: 27px;\n        left: 24px;\n        width: 54px;\n        height: 54px;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-header > :is(.saevyn-laurel, .saevyn-rose, .saevyn-halo) {\n        top: 27px;\n        left: 24px;\n        scale: 0.72;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-assembly {\n        grid-area: assembly;\n        grid-template-columns: 28px minmax(0, 1fr) 76px minmax(0, 1fr) 28px;\n        width: 100%;\n        height: 32px !important;\n        min-width: 0;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-endpoint {\n        width: 28px !important;\n        height: 32px !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-divider-rail {\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 32px !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark,\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-emblem {\n        width: 76px !important;\n        height: 32px !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-name {\n        grid-area: name;\n        margin: -0.08rem 0 0 !important;\n        text-align: center !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-segment-content {\n        margin-inline-start: 0 !important;\n    }\n    html[data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-segment-content::before {\n        display: none;\n    }\n}\n\n@media (prefers-reduced-motion: reduce) {\n    #saevyn-reverie-sky *,\n    body.saevyn-active .saevyn-speaker-header::before,\n    body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before {\n        animation: none !important;\n    }\n}\n\n/* =====================================================================\n   Saevyn Reverie 1.1 — filigree, speaker weather, and living light,\n   gated by html[data-saevyn-density], [data-saevyn-weather], and\n   [data-saevyn-lantern] from the appearance panel.\n   ===================================================================== */\n\n@keyframes reverie-laurel { to { rotate: 360deg; } }\n@keyframes reverie-sweep {\n    0%   { transform: translateX(-40%); opacity: 0; }\n    25%  { opacity: 1; }\n    100% { transform: translateX(260%); opacity: 0; }\n}\n@keyframes reverie-portrait-flash {\n    0%   { box-shadow: 0 0 0 3px color-mix(in srgb, var(--saevyn-bg) 92%, transparent), 0 0 0 4px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 90%, white), 0 0 60px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 90%, transparent); }\n    100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--saevyn-bg) 92%, transparent), 0 0 0 4px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 36%, transparent), 0 10px 28px color-mix(in srgb, var(--saevyn-bg) 60%, transparent), 0 0 30px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 42%, transparent); }\n}\n@keyframes reverie-flare {\n    0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--saevyn-gold) 62%, transparent), 0 0 100px color-mix(in srgb, var(--saevyn-glow) 80%, transparent); }\n    100% { box-shadow: 0 0 0 46px transparent, 0 0 48px color-mix(in srgb, var(--saevyn-glow) 22%, transparent); }\n}\n@keyframes reverie-beam { from { background-position: 0% 0; } to { background-position: 100% 0; } }\n@keyframes reverie-motes { from { background-position: 0 60px, 30px 80px; } to { background-position: 90px -60px, -40px -80px; } }\n@keyframes reverie-sparks {\n    0%, 100% { opacity: 0.25; background-position: 0 0, 40px 20px; }\n    50%      { opacity: 0.85; background-position: 12px -8px, 28px 30px; }\n}\n@keyframes reverie-rift { from { background-position: 0% 0; filter: hue-rotate(0deg); } to { background-position: 200% 0; filter: hue-rotate(40deg); } }\n@keyframes reverie-rays { from { background-position: 0 0; } to { background-position: 180px 0; } }\n\n/* ---------- Filigree corners (composer, user bubbles) ---------- */\n\nbody.saevyn-active .saevyn-filigree {\n    position: absolute;\n    inset: 0;\n    z-index: 1;\n    pointer-events: none;\n    overflow: hidden;\n    border-radius: inherit;\n}\nbody.saevyn-active .saevyn-flourish {\n    position: absolute;\n    width: 34px;\n    height: 34px;\n    color: var(--saevyn-gold);\n    fill: none;\n    stroke: currentColor;\n    stroke-width: 1.1;\n    stroke-linecap: round;\n    stroke-linejoin: round;\n    opacity: 0.62;\n    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--saevyn-gold) var(--reverie-flourish-glow), transparent));\n    transition: opacity 300ms ease, transform 300ms ease;\n}\nbody.saevyn-active .saevyn-flourish--tl { top: 6px; left: 7px; }\nbody.saevyn-active .saevyn-flourish--tr { top: 6px; right: 7px; transform: scaleX(-1); }\nbody.saevyn-active .saevyn-flourish--bl { bottom: 6px; left: 7px; transform: scaleY(-1); }\nbody.saevyn-active .saevyn-flourish--br { bottom: 6px; right: 7px; transform: scale(-1); }\nbody.saevyn-active .user-message-bubble-color { position: relative; }\nbody.saevyn-active .user-message-bubble-color .saevyn-flourish { width: 22px; height: 22px; opacity: 0.5; }\nbody.saevyn-active .user-message-bubble-color .saevyn-flourish--tl,\nbody.saevyn-active .user-message-bubble-color .saevyn-flourish--tr { top: 4px; }\nbody.saevyn-active .user-message-bubble-color .saevyn-flourish--bl,\nbody.saevyn-active .user-message-bubble-color .saevyn-flourish--br { bottom: 4px; }\nbody.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]:focus-within .saevyn-flourish { opacity: 0.95; }\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-flourish { width: 42px; height: 42px; opacity: 0.8; stroke-width: 1.25; }\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active .user-message-bubble-color .saevyn-flourish { width: 26px; height: 26px; }\nhtml[data-saevyn-density=\"quiet\"] body.saevyn-active .saevyn-filigree { display: none; }\n\n/* ---------- Laurel ring around each portrait ---------- */\n\nbody.saevyn-active .saevyn-laurel {\n    position: absolute;\n    /* Anchored to the portrait's center, not the header's, so the engraved\n       two-row layout keeps the ring on the portrait. */\n    top: 23px;\n    left: 23px;\n    z-index: 0;\n    width: 68px;\n    height: 68px;\n    translate: -50% -50%;\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 80%, white);\n    opacity: var(--reverie-laurel);\n    pointer-events: none;\n    animation: reverie-laurel 48s linear infinite reverse;\n}\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-laurel { width: 76px; height: 76px; opacity: calc(var(--reverie-laurel) * 1.5); }\nhtml[data-saevyn-density=\"quiet\"] body.saevyn-active .saevyn-laurel { display: none; }\nhtml[data-saevyn-motion=\"still\"] body.saevyn-active .saevyn-laurel { animation: none; }\n\n/* ---------- Line-end flourish (opulent only) ---------- */\n\nbody.saevyn-active .saevyn-flourish--line {\n    display: none;\n    position: static;\n    order: 3;\n    width: 20px;\n    height: 20px;\n    flex: 0 0 auto;\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 85%, white);\n    transform: scale(-1, 1) rotate(-90deg);\n    opacity: 0.7;\n}\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-flourish--line { display: block; }\n\n/* Speaker sigils begin each detected paragraph. Keep the first glyph inline:\n   a typographic drop cap turns emoji into a 43 px floated image and breaks the\n   opening line. Ornament belongs in the generated header, not message text. */\n\n/* ---------- Ornamental sidebar rules ---------- */\n\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2 {\n    display: flex !important;\n    align-items: center;\n    gap: 0.55rem;\n}\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2::before {\n    content: \"\";\n    flex: 0 0 auto;\n    width: 5px;\n    height: 5px;\n    rotate: 45deg;\n    background: var(--saevyn-gold);\n    box-shadow: 0 0 8px color-mix(in srgb, var(--saevyn-gold) 70%, transparent);\n}\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2::after {\n    content: \"\";\n    flex: 1 1 auto;\n    height: 1px;\n    background: linear-gradient(90deg, var(--reverie-hairline-strong), transparent);\n}\n\n/* ---------- Wax-seal send button ---------- */\n\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active form[data-type=\"unified-composer\"] .composer-submit-button-color:not(:disabled),\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active form[data-type=\"unified-composer\"] [data-testid=\"send-button\"]:not(:disabled),\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active form[data-type=\"unified-composer\"] button[type=\"submit\"]:not(:disabled) {\n    border-radius: 50% !important;\n    background:\n        radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--saevyn-gold-light) 65%, white) 0, color-mix(in srgb, var(--saevyn-gold-light) 40%, var(--saevyn-gold)) 30%, var(--saevyn-gold) 58%, var(--saevyn-gold-deep) 100%) !important;\n    box-shadow:\n        inset 0 0 0 2px color-mix(in srgb, var(--saevyn-gold-deep) 50%, transparent),\n        inset 0 0 0 3px color-mix(in srgb, var(--saevyn-gold-light) 45%, transparent),\n        inset 0 -4px 8px color-mix(in srgb, var(--saevyn-gold-deep) 70%, transparent),\n        inset 0 3px 6px color-mix(in srgb, white 22%, transparent),\n        0 4px 10px color-mix(in srgb, var(--saevyn-bg) 60%, transparent),\n        0 0 22px color-mix(in srgb, var(--saevyn-gold) 50%, transparent) !important;\n    transition: transform 120ms ease, box-shadow 160ms ease !important;\n}\nhtml:not([data-saevyn-density=\"quiet\"]) body.saevyn-active form[data-type=\"unified-composer\"] :is(.composer-submit-button-color, [data-testid=\"send-button\"], button[type=\"submit\"]):not(:disabled):active {\n    transform: scale(0.92) !important;\n    box-shadow:\n        inset 0 0 0 2px color-mix(in srgb, var(--saevyn-gold-deep) 60%, transparent),\n        inset 0 4px 10px color-mix(in srgb, var(--saevyn-gold-deep) 80%, transparent),\n        0 0 30px color-mix(in srgb, var(--saevyn-gold) 65%, transparent) !important;\n}\n\n/* ---------- Chapter numerals (opulent, wide screens) ---------- */\n\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active { counter-reset: saevyn-turn; }\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active section[data-turn=\"assistant\"] {\n    position: relative;\n    counter-increment: saevyn-turn;\n}\n@media (min-width: 1100px) {\n    html[data-saevyn-density=\"opulent\"] body.saevyn-active section[data-turn=\"assistant\"]::before {\n        content: counter(saevyn-turn, upper-roman);\n        position: absolute;\n        top: 1.55rem;\n        left: -76px;\n        width: 56px;\n        text-align: right;\n        font-family: var(--reverie-display-font);\n        font-size: 0.7rem;\n        letter-spacing: 0.22em;\n        color: color-mix(in srgb, var(--saevyn-gold) 62%, var(--saevyn-muted));\n        opacity: 0.75;\n        pointer-events: none;\n    }\n}\n\n/* ---------- Speaker weather ---------- */\n\nbody.saevyn-active .saevyn-speaker-header::after {\n    content: \"\";\n    position: absolute;\n    inset: -20px 0 -14px 58px;\n    z-index: 0;\n    pointer-events: none;\n    opacity: var(--reverie-weather);\n    border-radius: 12px;\n    /* Feather every weather layer so no rectangle ever shows against the sky. */\n    -webkit-mask-image: radial-gradient(ellipse 70% 80% at 50% 50%, #000 30%, transparent 78%);\n    mask-image: radial-gradient(ellipse 70% 80% at 50% 50%, #000 30%, transparent 78%);\n}\nhtml[data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-speaker-header::after { opacity: calc(var(--reverie-weather) * 1.6); inset: -26px 0 -18px 58px; }\nhtml[data-saevyn-weather=\"off\"] body.saevyn-active .saevyn-speaker-header::after { display: none; }\nhtml[data-saevyn-motion=\"still\"] body.saevyn-active .saevyn-speaker-header::after { animation: none !important; }\n\n/* Moon: a slow moonbeam crossing the header */\nbody.saevyn-active .saevyn-speaker-header[data-saevyn-speaker=\"moon\"]::after {\n    background: linear-gradient(112deg, transparent 32%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 26%, transparent) 46%, transparent 60%);\n    background-size: 300% 100%;\n    animation: reverie-beam 16s ease-in-out infinite alternate;\n}\n/* Sun: sun motes drifting upward */\nbody.saevyn-active .saevyn-speaker-header[data-saevyn-speaker=\"sun\"]::after {\n    background-image:\n        radial-gradient(2px 2px at 14% 62%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 95%, white), transparent 70%),\n        radial-gradient(1.5px 1.5px at 48% 30%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 85%, white), transparent 70%);\n    background-size: 160px 90px, 220px 120px;\n    animation: reverie-motes 22s linear infinite;\n}\n/* Blade: teal sparks flickering */\nbody.saevyn-active .saevyn-speaker-header[data-saevyn-speaker=\"blade\"]::after {\n    background-image:\n        radial-gradient(1.6px 1.6px at 22% 40%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 95%, white), transparent 70%),\n        radial-gradient(1.2px 1.2px at 70% 68%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 90%, white), transparent 70%);\n    background-size: 120px 70px, 170px 90px;\n    animation: reverie-sparks 3.6s ease-in-out infinite;\n}\n/* Ember'Zahrin: a rift shimmer sliding through */\nbody.saevyn-active .saevyn-speaker-header[data-saevyn-speaker=\"ember\"]::after {\n    background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--saevyn-aurora) 22%, transparent) 25%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 28%, transparent) 55%, transparent 80%);\n    background-size: 200% 100%;\n    opacity: 0.4;\n    animation: reverie-rift 12s linear infinite;\n}\n/* Star: first-light rays */\nbody.saevyn-active .saevyn-speaker-header[data-saevyn-speaker=\"star\"]::after {\n    background: repeating-linear-gradient(104deg, transparent 0 14px, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 16%, transparent) 14px 18px, transparent 18px 34px);\n    background-size: 180px 100%;\n    opacity: 0.35;\n    animation: reverie-rays 28s linear infinite;\n}\n\n/* ---------- Living light: lantern and arrival ---------- */\n\nbody.saevyn-active.saevyn-typing form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before {\n    animation-duration: 3.2s;\n    opacity: 1;\n}\nbody.saevyn-active.saevyn-send-flare form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n    animation: reverie-flare 1s ease-out;\n}\nbody.saevyn-active .saevyn-divider-assembly { position: relative; }\nbody.saevyn-active .saevyn-speaker-header--arriving .saevyn-divider-assembly::after {\n    content: \"\";\n    position: absolute;\n    top: 50%;\n    left: 0;\n    width: 36%;\n    height: 1px;\n    translate: 0 -50%;\n    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 90%, white), transparent);\n    box-shadow: 0 0 10px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 70%, transparent);\n    pointer-events: none;\n    animation: reverie-sweep 1.4s ease-out 1 forwards;\n}\nbody.saevyn-active .saevyn-speaker-header--arriving .saevyn-portrait {\n    animation: reverie-portrait-flash 1.4s ease-out 1;\n}\nhtml[data-saevyn-lantern=\"off\"] body.saevyn-active.saevyn-typing form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before { animation-duration: 16s; opacity: 0.85; }\nhtml[data-saevyn-lantern=\"off\"] body.saevyn-active.saevyn-send-flare form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"],\nhtml[data-saevyn-lantern=\"off\"] body.saevyn-active .saevyn-speaker-header--arriving .saevyn-divider-assembly::after,\nhtml[data-saevyn-lantern=\"off\"] body.saevyn-active .saevyn-speaker-header--arriving .saevyn-portrait { animation: none; }\n\n/* Glow: none also skips the one-off arrival flash on the portrait ring. */\nhtml[data-saevyn-glow=\"none\"] body.saevyn-active .saevyn-speaker-header--arriving .saevyn-portrait { animation: none; }\n\n/* ---------- Narrow screens ---------- */\n\n@media (max-width: 720px) {\n    body.saevyn-active .saevyn-laurel { top: 19px; left: 19px; width: 56px; height: 56px; }\n    html[data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-laurel { width: 62px; height: 62px; }\n    body.saevyn-active .saevyn-speaker-header::after { inset: -16px 0 -10px 48px; }\n    body.saevyn-active .saevyn-flourish { width: 26px; height: 26px; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n    body.saevyn-active .saevyn-laurel,\n    body.saevyn-active .saevyn-speaker-header::after,\n    body.saevyn-active .saevyn-speaker-header--arriving .saevyn-divider-assembly::after,\n    body.saevyn-active .saevyn-speaker-header--arriving .saevyn-portrait,\n    body.saevyn-active.saevyn-send-flare form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n        animation: none !important;\n    }\n}\n\n/* =====================================================================\n   Saevyn Reverie 1.2 — Cathedral Glass look.\n   Active under html[data-saevyn-look=\"cathedral\"]. Everything is CSS\n   gradients and the inline rose-window symbol: no images, so ChatGPT's\n   image policy never sees it. Lead is the dark came between panes; panes\n   are theme colors at low alpha so every preset makes its own window.\n   ===================================================================== */\n\n@keyframes reverie-candle {\n    0%, 100% { filter: opacity(1); transform: translateX(-50%) scaleX(1); }\n    37%      { filter: opacity(0.8); transform: translateX(-50%) scaleX(1.03); }\n    64%      { filter: opacity(0.9); transform: translateX(-50%) scaleX(0.985); }\n}\n@keyframes reverie-glass-drift { from { background-position: 0 0; } to { background-position: 140px 0; } }\n\nhtml[data-saevyn-look=\"cathedral\"] {\n    --cg-lead: color-mix(in srgb, var(--saevyn-bg) 55%, black);\n    --cg-lead-light: color-mix(in srgb, var(--saevyn-gold) 40%, transparent);\n    --cg-pane-a: color-mix(in srgb, var(--saevyn-glow) 30%, transparent);\n    --cg-pane-b: color-mix(in srgb, var(--saevyn-aurora) 20%, transparent);\n    --cg-pane-c: color-mix(in srgb, var(--saevyn-gold) 18%, transparent);\n    --cg-pane-d: color-mix(in srgb, var(--saevyn-secondary, var(--saevyn-aurora)) 24%, transparent);\n    --cg-pane-e: color-mix(in srgb, var(--saevyn-gold-deep) 22%, transparent);\n    --cg-rw-x: 50%;\n    --cg-rw-y: -32vh;\n    --reverie-radius: 14px;\n}\n\n/* Sky layers only the cathedral uses */\n#saevyn-reverie-sky .glass,\n#saevyn-reverie-sky .candle { display: none; }\n\nhtml[data-saevyn-look=\"cathedral\"] #saevyn-reverie-sky .orb { opacity: 0.72; }\nhtml[data-saevyn-look=\"cathedral\"] #saevyn-reverie-sky .stars--near { opacity: 0.3; }\n\n/* The rose window: sixteen sectors of alternating pane color, lead spokes\n   and rings, and a second ring pattern so the panes read as a tracery\n   rather than a pie chart. It fades out toward the reading area. */\nhtml[data-saevyn-look=\"cathedral\"] #saevyn-reverie-sky .glass {\n    display: block;\n    position: absolute;\n    inset: 0;\n    background:\n        repeating-conic-gradient(from 0deg at var(--cg-rw-x) var(--cg-rw-y), transparent 0deg 22.5deg, var(--cg-lead) 22.5deg 22.9deg),\n        repeating-conic-gradient(from 11.25deg at var(--cg-rw-x) var(--cg-rw-y), transparent 0deg 22.5deg, color-mix(in srgb, var(--cg-lead) 55%, transparent) 22.5deg 22.75deg),\n        repeating-radial-gradient(circle at var(--cg-rw-x) var(--cg-rw-y), transparent 0 128px, var(--cg-lead) 128px 130px),\n        repeating-radial-gradient(circle at var(--cg-rw-x) var(--cg-rw-y), transparent 0 130px, var(--cg-pane-e) 130px 260px),\n        conic-gradient(from 0deg at var(--cg-rw-x) var(--cg-rw-y),\n            var(--cg-pane-a) 0deg 22.5deg, var(--cg-pane-b) 22.5deg 45deg, var(--cg-pane-c) 45deg 67.5deg, var(--cg-pane-d) 67.5deg 90deg,\n            var(--cg-pane-a) 90deg 112.5deg, var(--cg-pane-b) 112.5deg 135deg, var(--cg-pane-c) 135deg 157.5deg, var(--cg-pane-d) 157.5deg 180deg,\n            var(--cg-pane-a) 180deg 202.5deg, var(--cg-pane-b) 202.5deg 225deg, var(--cg-pane-c) 225deg 247.5deg, var(--cg-pane-d) 247.5deg 270deg,\n            var(--cg-pane-a) 270deg 292.5deg, var(--cg-pane-b) 292.5deg 315deg, var(--cg-pane-c) 315deg 337.5deg, var(--cg-pane-d) 337.5deg 360deg);\n    -webkit-mask-image: radial-gradient(circle at var(--cg-rw-x) var(--cg-rw-y), #000 0, #000 48vmax, transparent 88vmax);\n    mask-image: radial-gradient(circle at var(--cg-rw-x) var(--cg-rw-y), #000 0, #000 48vmax, transparent 88vmax);\n    opacity: 0.62;\n}\nhtml[data-saevyn-look=\"cathedral\"] #saevyn-reverie-sky .veil {\n    background:\n        linear-gradient(180deg, color-mix(in srgb, var(--saevyn-bg) 22%, transparent), transparent 28%, transparent 62%, color-mix(in srgb, var(--saevyn-bg) 62%, transparent)),\n        linear-gradient(90deg, transparent, color-mix(in srgb, var(--saevyn-bg) 34%, transparent) 30%, color-mix(in srgb, var(--saevyn-bg) 34%, transparent) 70%, transparent);\n}\n\n/* A candle below the composer. Gated by the glow level like everything else. */\nhtml[data-saevyn-look=\"cathedral\"] #saevyn-reverie-sky .candle {\n    display: block;\n    position: absolute;\n    left: 50%;\n    bottom: -12vh;\n    width: 76vmax;\n    height: 42vh;\n    transform: translateX(-50%);\n    background: radial-gradient(ellipse at 50% 100%, color-mix(in srgb, var(--saevyn-gold) 24%, transparent), color-mix(in srgb, var(--saevyn-glow) 10%, transparent) 40%, transparent 68%);\n    opacity: var(--reverie-candle);\n    animation: reverie-candle 4.6s ease-in-out infinite;\n}\nhtml[data-saevyn-motion=\"still\"] #saevyn-reverie-sky .candle { animation: none; }\n\n/* ---------- Leaded frames ---------- */\n\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"],\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .user-message-bubble-color,\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active [role=\"menu\"][data-radix-menu-content],\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .popover.shadow-short-composer:has(.__menu-item),\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]),\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active [data-testid=\"modal-global-search\"] > .popover,\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active [data-testid^=\"modal-\"] [role=\"dialog\"].popover,\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active dialog > [data-testid^=\"modal-\"],\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active [role=\"dialog\"]:has(input[aria-label=\"Search settings\"]) {\n    border: 1px solid var(--cg-lead-light) !important;\n    border-radius: 14px !important;\n    box-shadow:\n        0 0 0 3px var(--cg-lead),\n        0 0 0 4px var(--cg-lead-light),\n        0 22px 60px color-mix(in srgb, var(--saevyn-bg) 58%, transparent) !important;\n}\n\n/* Faceted glass: four panes meeting off-center, like shards in a came. */\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .user-message-bubble-color {\n    border-radius: 14px 14px 4px 14px !important;\n    background:\n        conic-gradient(from 0deg at 38% 58%, var(--cg-pane-a) 0deg 90deg, var(--cg-pane-c) 90deg 180deg, var(--cg-pane-b) 180deg 270deg, var(--cg-pane-d) 270deg 360deg),\n        color-mix(in srgb, var(--saevyn-panel) 62%, transparent) !important;\n    font-style: normal;\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n    background:\n        linear-gradient(160deg, var(--cg-pane-a), transparent 45%),\n        linear-gradient(340deg, var(--cg-pane-c), transparent 40%),\n        linear-gradient(160deg, color-mix(in srgb, var(--saevyn-panel) 76%, transparent), color-mix(in srgb, var(--saevyn-bg) 84%, transparent)) !important;\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before { opacity: 0.5; }\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-flourish { display: none; }\n\n/* ---------- Sidebar: a tall leaded window ---------- */\n\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active #stage-slideover-sidebar,\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active #stage-popover-sidebar {\n    isolation: isolate;\n    border-inline-end: 1px solid var(--cg-lead-light) !important;\n    box-shadow: inset -4px 0 0 var(--cg-lead), inset -5px 0 0 var(--cg-lead-light), 14px 0 56px color-mix(in srgb, var(--saevyn-bg) 42%, transparent) !important;\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active #stage-slideover-sidebar::before,\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active #stage-popover-sidebar::before {\n    content: \"\";\n    display: block !important;\n    position: absolute;\n    inset: 0;\n    z-index: -1;\n    border: 0;\n    border-radius: 0;\n    background:\n        repeating-linear-gradient(180deg, transparent 0 118px, var(--cg-lead) 118px 119px),\n        repeating-linear-gradient(90deg, transparent 0 96px, color-mix(in srgb, var(--cg-lead) 70%, transparent) 96px 97px),\n        linear-gradient(180deg, var(--cg-pane-a), transparent 30%, var(--cg-pane-b) 60%, transparent 80%, var(--cg-pane-c));\n    opacity: 0.55;\n    pointer-events: none;\n}\n\n/* ---------- Speaker headers: lead came, lozenge pane, rose window ---------- */\n\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-divider-assembly::before {\n    height: 3px;\n    border-radius: 2px;\n    background: linear-gradient(180deg,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 55%, transparent),\n        var(--cg-lead) 45% 55%,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 35%, transparent));\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-speaker-mark {\n    width: 26px !important;\n    height: 26px !important;\n    min-width: 0;\n    rotate: 45deg;\n    border: 1px solid var(--cg-lead-light);\n    background:\n        conic-gradient(from 0deg at 50% 50%, var(--cg-pane-a) 0deg 90deg, var(--cg-pane-c) 90deg 180deg, var(--cg-pane-b) 180deg 270deg, var(--cg-pane-d) 270deg 360deg),\n        color-mix(in srgb, var(--saevyn-bg) 70%, transparent);\n    box-shadow: 0 0 0 2px var(--cg-lead), 0 0 0 3px var(--cg-lead-light);\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-speaker-mark::after {\n    rotate: -45deg;\n    font-size: 0.85rem;\n}\nhtml[data-saevyn-look=\"cathedral\"][data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark {\n    width: 126px !important;\n    height: 46px !important;\n    rotate: 0deg;\n    border: 0;\n    background: none;\n    box-shadow: none;\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-portrait {\n    box-shadow:\n        0 0 0 2px var(--cg-lead),\n        0 0 0 3px var(--cg-lead-light),\n        0 10px 28px color-mix(in srgb, var(--saevyn-bg) 60%, transparent);\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-laurel { display: none; }\nbody.saevyn-active .saevyn-rose {\n    display: none;\n    position: absolute;\n    top: 23px;\n    left: 23px;\n    z-index: 0;\n    width: 80px;\n    height: 80px;\n    translate: -50% -50%;\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 78%, white);\n    opacity: 0.5;\n    pointer-events: none;\n    animation: reverie-laurel 120s linear infinite;\n}\nhtml[data-saevyn-look=\"cathedral\"]:not([data-saevyn-density=\"quiet\"]) body.saevyn-active .saevyn-rose { display: block; }\nhtml[data-saevyn-look=\"cathedral\"][data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-rose { width: 90px; height: 90px; opacity: 0.68; }\nhtml[data-saevyn-motion=\"still\"] body.saevyn-active .saevyn-rose { animation: none; }\n\n/* Light through glass replaces speaker weather: a faceted pane behind the header. */\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-speaker-header::after {\n    background:\n        linear-gradient(var(--cg-lead), var(--cg-lead)) 34% 0 / 1px 100% no-repeat,\n        linear-gradient(var(--cg-lead), var(--cg-lead)) 72% 0 / 1px 100% no-repeat,\n        conic-gradient(from 200deg at 34% 50%,\n            color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 18%, transparent) 0deg 110deg,\n            var(--cg-pane-b) 110deg 200deg,\n            var(--cg-pane-a) 200deg 290deg,\n            color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 10%, transparent) 290deg 360deg);\n    background-size: 100% 100%, 100% 100%, 260px 100%;\n    opacity: calc(var(--reverie-weather) * 1.4);\n    animation: reverie-glass-drift 60s linear infinite;\n}\n\n/* ---------- Type and details ---------- */\n\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-speaker-name {\n    letter-spacing: 0.3em !important;\n    color: color-mix(in srgb, var(--saevyn-gold-light) 55%, var(--saevyn-text)) !important;\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active section[data-turn=\"assistant\"] .markdown blockquote {\n    border-left: 3px solid var(--cg-lead) !important;\n    box-shadow: inset 1px 0 0 var(--cg-lead-light);\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active section[data-turn=\"assistant\"] .markdown pre {\n    border-color: var(--cg-lead-light) !important;\n    box-shadow: 0 0 0 2px var(--cg-lead), inset 0 1px 0 color-mix(in srgb, var(--saevyn-gold-light) 8%, transparent);\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2::before {\n    rotate: 45deg;\n    border: 1px solid var(--cg-lead-light);\n    background: var(--cg-pane-c);\n    box-shadow: 0 0 0 1px var(--cg-lead);\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active :is([role=\"tablist\"], [role=\"radiogroup\"]) {\n    border-radius: 12px !important;\n    box-shadow: 0 0 0 2px var(--cg-lead);\n}\nhtml[data-saevyn-look=\"cathedral\"] body.saevyn-active :is([role=\"tab\"], [role=\"radio\"]) { border-radius: 9px !important; }\n\n@media (max-width: 720px) {\n    html[data-saevyn-look=\"cathedral\"] { --cg-rw-y: -22vh; }\n    body.saevyn-active .saevyn-rose { top: 19px; left: 19px; width: 64px; height: 64px; }\n    html[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-speaker-mark { width: 22px !important; height: 22px !important; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n    #saevyn-reverie-sky .candle,\n    body.saevyn-active .saevyn-rose,\n    html[data-saevyn-look=\"cathedral\"] body.saevyn-active .saevyn-speaker-header::after { animation: none !important; }\n}\n\n/* =====================================================================\n   Saevyn Reverie 1.3 — Art Nouveau look.\n   Active under html[data-saevyn-look=\"nouveau\"]. Whiplash curves, lilies,\n   and a Mucha halo, all inline SVG symbols or CSS; organic double-lined\n   frames; petal buds for the sigils. No images anywhere.\n   ===================================================================== */\n\n@keyframes reverie-vines-breathe {\n    from { transform: scale(1) translateY(0); }\n    to   { transform: scale(1.035) translateY(-0.6%); }\n}\n\nhtml[data-saevyn-look=\"nouveau\"] {\n    --an-line: color-mix(in srgb, var(--saevyn-gold) 62%, transparent);\n    --an-line-soft: color-mix(in srgb, var(--saevyn-gold) 30%, transparent);\n    --an-wash: color-mix(in srgb, var(--saevyn-gold) 8%, transparent);\n    --an-leaf: color-mix(in srgb, var(--saevyn-secondary, var(--saevyn-aurora)) 18%, transparent);\n    --reverie-radius: 22px;\n}\n\n/* ---------- Sky: vines instead of stars ---------- */\n\n#saevyn-reverie-sky .vines { display: none; }\nhtml[data-saevyn-look=\"nouveau\"] #saevyn-reverie-sky .vines {\n    display: block;\n    position: absolute;\n    inset: 0;\n    width: 100%;\n    height: 100%;\n    color: var(--saevyn-gold);\n    opacity: 0.17;\n    transform-origin: 50% 60%;\n    animation: reverie-vines-breathe 34s ease-in-out infinite alternate;\n}\nhtml[data-saevyn-look=\"nouveau\"] #saevyn-reverie-sky .stars { display: none; }\nhtml[data-saevyn-look=\"nouveau\"] #saevyn-reverie-sky .orb { opacity: 0.78; filter: blur(120px); }\nhtml[data-saevyn-look=\"nouveau\"] #saevyn-reverie-sky .orb-3 { opacity: 0.9; }\nhtml[data-saevyn-look=\"nouveau\"] #saevyn-reverie-sky .veil {\n    background:\n        radial-gradient(ellipse 70% 60% at 50% 50%, transparent 40%, color-mix(in srgb, var(--saevyn-bg) 45%, transparent) 100%),\n        linear-gradient(180deg, color-mix(in srgb, var(--saevyn-glow) 14%, transparent), transparent 30%, transparent 70%, color-mix(in srgb, var(--saevyn-bg) 55%, transparent));\n}\nhtml[data-saevyn-motion=\"still\"] #saevyn-reverie-sky .vines { animation: none; }\n\n/* ---------- Organic double-lined frames ---------- */\n\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"],\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active [role=\"menu\"][data-radix-menu-content],\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .popover.shadow-short-composer:has(.__menu-item),\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]),\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active [data-testid=\"modal-global-search\"] > .popover,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active [data-testid^=\"modal-\"] [role=\"dialog\"].popover,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active dialog > [data-testid^=\"modal-\"],\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active [role=\"dialog\"]:has(input[aria-label=\"Search settings\"]) {\n    border: 1px solid var(--an-line) !important;\n    border-radius: 26px 12px 26px 12px !important;\n    outline: 1px solid var(--an-line-soft);\n    outline-offset: -6px;\n    box-shadow: 0 22px 60px color-mix(in srgb, var(--saevyn-bg) 58%, transparent) !important;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .user-message-bubble-color {\n    border: 1px solid var(--an-line) !important;\n    border-radius: 24px 10px 24px 10px !important;\n    outline: 1px solid var(--an-line-soft);\n    outline-offset: -5px;\n    background:\n        radial-gradient(ellipse at 12% 0%, var(--an-leaf), transparent 55%),\n        linear-gradient(160deg, var(--an-wash), color-mix(in srgb, var(--saevyn-panel) 60%, transparent)) !important;\n    box-shadow: 0 12px 34px color-mix(in srgb, var(--saevyn-bg) 42%, transparent) !important;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n    background:\n        radial-gradient(ellipse at 90% 100%, var(--an-leaf), transparent 50%),\n        linear-gradient(160deg, var(--an-wash), transparent 40%),\n        linear-gradient(160deg, color-mix(in srgb, var(--saevyn-panel) 76%, transparent), color-mix(in srgb, var(--saevyn-bg) 84%, transparent)) !important;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"]::before { opacity: 0.3; }\n\n/* Tendril corners replace the bracket flourishes */\nbody.saevyn-active .saevyn-tendril { display: none; }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-flourish--tl,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-flourish--tr,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-flourish--bl,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-flourish--br { display: none; }\nhtml[data-saevyn-look=\"nouveau\"]:not([data-saevyn-density=\"quiet\"]) body.saevyn-active .saevyn-tendril {\n    display: block;\n    position: absolute;\n    width: 40px;\n    height: 40px;\n    color: var(--saevyn-gold);\n    fill: none;\n    stroke: currentColor;\n    stroke-width: 1.1;\n    stroke-linecap: round;\n    stroke-linejoin: round;\n    opacity: 0.7;\n    transition: opacity 300ms ease;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-tendril--tl { top: 5px; left: 6px; }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-tendril--tr { top: 5px; right: 6px; transform: scaleX(-1); }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-tendril--bl { bottom: 5px; left: 6px; transform: scaleY(-1); }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-tendril--br { bottom: 5px; right: 6px; transform: scale(-1); }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .user-message-bubble-color .saevyn-tendril { width: 26px; height: 26px; opacity: 0.55; }\nhtml[data-saevyn-look=\"nouveau\"][data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-tendril { width: 50px; height: 50px; opacity: 0.85; }\nhtml[data-saevyn-look=\"nouveau\"][data-saevyn-density=\"opulent\"] body.saevyn-active .user-message-bubble-color .saevyn-tendril { width: 30px; height: 30px; }\n\n/* ---------- Sidebar: a beaded botanical border ---------- */\n\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active #stage-slideover-sidebar,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active #stage-popover-sidebar {\n    isolation: isolate;\n    border-inline-end: 1px solid var(--an-line) !important;\n    box-shadow: inset -7px 0 0 transparent, inset -8px 0 0 var(--an-line-soft), 14px 0 56px color-mix(in srgb, var(--saevyn-bg) 42%, transparent) !important;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active #stage-slideover-sidebar::before,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active #stage-popover-sidebar::before {\n    content: \"\";\n    display: block !important;\n    position: absolute;\n    inset: 0;\n    z-index: -1;\n    border: 0;\n    border-radius: 0;\n    background:\n        radial-gradient(ellipse 5px 11px at 50% 50%, var(--an-line) 58%, transparent 62%) right 2px top 0 / 12px 30px repeat-y,\n        radial-gradient(circle 2px at 50% 50%, var(--an-line-soft) 90%, transparent 100%) right 2px top 15px / 12px 30px repeat-y,\n        linear-gradient(180deg, var(--an-wash), transparent 35%, var(--an-leaf) 70%, transparent);\n    pointer-events: none;\n}\n\n/* ---------- Headers: Mucha halo, double hairline, petal bud ---------- */\n\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-laurel,\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-rose { display: none; }\nbody.saevyn-active .saevyn-halo {\n    display: none;\n    position: absolute;\n    top: 23px;\n    left: 23px;\n    z-index: 0;\n    width: 88px;\n    height: 88px;\n    translate: -50% -50%;\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 82%, white);\n    opacity: 0.6;\n    pointer-events: none;\n}\nhtml[data-saevyn-look=\"nouveau\"]:not([data-saevyn-density=\"quiet\"]) body.saevyn-active .saevyn-halo { display: block; }\nhtml[data-saevyn-look=\"nouveau\"][data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-halo { width: 100px; height: 100px; opacity: 0.78; }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-portrait {\n    box-shadow:\n        0 0 0 2px color-mix(in srgb, var(--saevyn-bg) 92%, transparent),\n        0 0 0 3px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 70%, transparent),\n        0 10px 28px color-mix(in srgb, var(--saevyn-bg) 60%, transparent);\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-divider-assembly::before {\n    height: 5px;\n    background:\n        linear-gradient(90deg, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 60%, transparent), color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 20%, transparent) 70%, transparent) 0 0 / 100% 1px no-repeat,\n        linear-gradient(90deg, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 32%, transparent), transparent 60%) 0 100% / 100% 1px no-repeat;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-speaker-mark {\n    width: 28px !important;\n    height: 28px !important;\n    min-width: 0;\n    rotate: -45deg;\n    border: 1px solid color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 62%, transparent);\n    border-radius: 50% 50% 50% 0;\n    background:\n        radial-gradient(circle at 35% 35%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 18%, transparent), transparent 70%),\n        color-mix(in srgb, var(--saevyn-bg) 70%, transparent);\n    box-shadow: inset 0 0 0 3px transparent, inset 0 0 0 4px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 22%, transparent);\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-speaker-mark::after {\n    rotate: 45deg;\n    font-size: 0.85rem;\n}\nhtml[data-saevyn-look=\"nouveau\"][data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-speaker-mark {\n    width: 126px !important;\n    height: 46px !important;\n    rotate: 0deg;\n    border: 0;\n    border-radius: 0;\n    background: none;\n    box-shadow: none;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-speaker-name {\n    letter-spacing: 0.2em !important;\n    font-weight: 600 !important;\n    font-size: 0.76rem !important;\n    color: color-mix(in srgb, var(--saevyn-gold) 70%, var(--saevyn-text)) !important;\n}\n/* A quiet leaf-shaped wash replaces speaker weather */\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-speaker-header::after {\n    background: radial-gradient(ellipse 60% 100% at 24% 50%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 16%, transparent), transparent 70%);\n    background-size: 100% 100%;\n    opacity: calc(var(--reverie-weather) * 1.2);\n    animation: none;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-segment-content::before {\n    width: 2px;\n    background: linear-gradient(180deg,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 45%, transparent),\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 12%, transparent));\n    border-radius: 1px;\n}\n\n/* ---------- Type and details ---------- */\n\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active section[data-turn=\"assistant\"] .markdown blockquote {\n    border-left: 0 !important;\n    padding-left: 1.3rem;\n    background: linear-gradient(180deg, var(--an-line), var(--an-line-soft)) 0 0 / 1px 100% no-repeat, linear-gradient(180deg, transparent, var(--an-line-soft), transparent) 5px 0 / 1px 100% no-repeat;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active section[data-turn=\"assistant\"] .markdown pre {\n    border-color: var(--an-line-soft) !important;\n    border-radius: 18px 8px 18px 8px !important;\n    outline: 1px solid var(--an-line-soft);\n    outline-offset: -5px;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2::before {\n    rotate: -45deg;\n    border-radius: 50% 50% 50% 0;\n    width: 7px;\n    height: 7px;\n    box-shadow: none;\n    background: var(--saevyn-gold);\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active :is([role=\"tablist\"], [role=\"radiogroup\"]) {\n    border-radius: 18px 8px 18px 8px !important;\n    outline: 1px solid var(--an-line-soft);\n    outline-offset: -4px;\n}\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active :is([role=\"tab\"], [role=\"radio\"]) { border-radius: 14px 6px 14px 6px !important; }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .btn-primary:not(:disabled),\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .interactive-button-primary:not(:disabled),\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active .btn-secondary { border-radius: 16px 6px 16px 6px !important; }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) a[data-sidebar-item=\"true\"]:not(#sidebar-header a) { border-radius: 14px 6px 14px 6px !important; }\nhtml[data-saevyn-look=\"nouveau\"] body.saevyn-active [data-testid=\"accounts-profile-button\"] { border-radius: 16px 6px 16px 6px !important; }\n\n@media (max-width: 720px) {\n    body.saevyn-active .saevyn-halo { top: 19px; left: 19px; width: 70px; height: 70px; }\n    html[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-speaker-mark { width: 24px !important; height: 24px !important; }\n    html[data-saevyn-look=\"nouveau\"] body.saevyn-active .saevyn-tendril { width: 30px; height: 30px; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n    #saevyn-reverie-sky .vines { animation: none !important; }\n}\n\n/* =====================================================================\n   Saevyn Reverie 1.5 — Tidepool look.\n   Active under html[data-saevyn-look=\"tidepool\"]. Bioluminescent caustics\n   rippling over the glass (an inline turbulence filter masking a theme\n   gradient), rising bubbles, three slow jellyfish, wave-scalloped\n   hairlines, ripple rings behind portraits, pebble-smooth frames.\n   ===================================================================== */\n\n@keyframes reverie-caustic-a {\n    from { transform: translate3d(0, 0, 0) scale(1); }\n    to   { transform: translate3d(-5%, -4%, 0) scale(1.08); }\n}\n@keyframes reverie-caustic-b {\n    from { transform: scaleX(-1) translate3d(0, 0, 0) scale(1.04); }\n    to   { transform: scaleX(-1) translate3d(6%, 5%, 0) scale(1); }\n}\n@keyframes reverie-bubbles { to { background-position: 0 -520px, 70px -820px; } }\n@keyframes reverie-jelly {\n    0%   { transform: translate3d(0, 0, 0) scaleY(1); }\n    12%  { transform: translate3d(1.5vw, -14vh, 0) scaleY(0.94); }\n    25%  { transform: translate3d(-1vw, -28vh, 0) scaleY(1.04); }\n    50%  { transform: translate3d(2vw, -56vh, 0) scaleY(0.96); }\n    75%  { transform: translate3d(-2vw, -84vh, 0) scaleY(1.03); }\n    100% { transform: translate3d(0.5vw, -112vh, 0) scaleY(1); }\n}\n@keyframes reverie-ripple-pulse {\n    0%   { transform: translate(-50%, -50%) scale(0.86); opacity: 0.55; }\n    70%  { opacity: 0.18; }\n    100% { transform: translate(-50%, -50%) scale(1.18); opacity: 0; }\n}\n@keyframes reverie-water-drift { from { background-position: 0 0, 0 0; } to { background-position: 220px 0, -180px 0; } }\n\nhtml[data-saevyn-look=\"tidepool\"] {\n    --tp-water: color-mix(in srgb, var(--saevyn-secondary, var(--saevyn-aurora)) 54%, var(--saevyn-glow));\n    --tp-foam: color-mix(in srgb, var(--saevyn-text) 70%, var(--saevyn-aurora));\n    --tp-line: color-mix(in srgb, var(--saevyn-gold) 55%, transparent);\n    --tp-line-soft: color-mix(in srgb, var(--saevyn-gold) 24%, transparent);\n    --tp-wash: color-mix(in srgb, var(--saevyn-aurora) 10%, transparent);\n    --reverie-radius: 28px;\n}\n\n/* ---------- Sky: caustics, bubbles, jellyfish ---------- */\n\n#saevyn-reverie-sky .caustics,\n#saevyn-reverie-sky .bubbles,\n#saevyn-reverie-sky .jelly { display: none; }\n\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .stars { display: none; }\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .orb { opacity: 0.8; filter: blur(125px); }\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .orb-3 { opacity: 0.62; }\n\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .caustics {\n    display: block;\n    position: absolute;\n    inset: -22%;\n    background: linear-gradient(120deg, var(--saevyn-aurora), var(--saevyn-gold) 55%, var(--saevyn-aurora));\n    filter: url(\"#saevyn-caustics\");\n    mix-blend-mode: screen;\n    opacity: 0.26;\n    will-change: transform;\n}\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .caustics--a { animation: reverie-caustic-a 46s ease-in-out infinite alternate; }\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .caustics--b { opacity: 0.16; animation: reverie-caustic-b 58s ease-in-out infinite alternate; }\n\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .bubbles {\n    display: block;\n    position: absolute;\n    inset: 0;\n    background-image:\n        radial-gradient(circle at 50% 50%, transparent 2.6px, color-mix(in srgb, var(--tp-foam) 55%, transparent) 3px 3.8px, transparent 4.4px),\n        radial-gradient(circle at 50% 50%, transparent 1.6px, color-mix(in srgb, var(--tp-foam) 45%, transparent) 2px 2.6px, transparent 3.2px);\n    background-size: 240px 520px, 320px 820px;\n    background-position: 0 0, 70px 0;\n    opacity: 0.5;\n    animation: reverie-bubbles 70s linear infinite;\n}\n\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .jelly {\n    display: block;\n    position: absolute;\n    bottom: -18vh;\n    width: 120px;\n    height: 92px;\n    border-radius: 50% 50% 46% 46% / 62% 62% 38% 38%;\n    background:\n        radial-gradient(ellipse at 50% 30%,\n            color-mix(in srgb, var(--saevyn-gold) 34%, transparent),\n            color-mix(in srgb, var(--saevyn-aurora) 16%, transparent) 55%,\n            transparent 74%);\n    box-shadow: inset 0 -6px 14px color-mix(in srgb, var(--saevyn-aurora) 14%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tp-foam) 20%, transparent);\n    opacity: 0.55;\n    will-change: transform;\n}\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .jelly::after {\n    content: \"\";\n    position: absolute;\n    top: 64%;\n    left: 22%;\n    width: 56%;\n    height: 190%;\n    background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--saevyn-aurora) 45%, transparent) 0 1px, transparent 1px 9px);\n    -webkit-mask-image: linear-gradient(180deg, #000, transparent 85%);\n    mask-image: linear-gradient(180deg, #000, transparent 85%);\n    opacity: 0.7;\n}\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .jelly-1 { left: 12vw; animation: reverie-jelly 150s linear infinite; }\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .jelly-2 { left: 58vw; width: 84px; height: 66px; opacity: 0.4; animation: reverie-jelly 190s linear -70s infinite; }\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .jelly-3 { left: 82vw; width: 150px; height: 112px; opacity: 0.35; animation: reverie-jelly 230s linear -140s infinite; }\nhtml[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .veil {\n    background:\n        linear-gradient(180deg, color-mix(in srgb, var(--tp-water) 22%, transparent), transparent 26%, transparent 70%, color-mix(in srgb, var(--saevyn-bg) 62%, transparent)),\n        radial-gradient(ellipse 80% 70% at 50% 50%, transparent 55%, color-mix(in srgb, var(--saevyn-bg) 40%, transparent) 100%);\n}\nhtml[data-saevyn-motion=\"still\"] #saevyn-reverie-sky :is(.caustics, .bubbles, .jelly) { animation: none !important; }\n\n/* ---------- Pebble frames: wet glass ---------- */\n\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"],\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .user-message-bubble-color,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active [role=\"menu\"][data-radix-menu-content],\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .popover.shadow-short-composer:has(.__menu-item),\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]),\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active [data-testid=\"modal-global-search\"] > .popover,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active [data-testid^=\"modal-\"] [role=\"dialog\"].popover,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active dialog > [data-testid^=\"modal-\"],\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active [role=\"dialog\"]:has(input[aria-label=\"Search settings\"]) {\n    border: 1px solid var(--tp-line-soft) !important;\n    border-radius: 28px !important;\n    box-shadow:\n        inset 0 1px 0 color-mix(in srgb, var(--tp-foam) 22%, transparent),\n        inset 0 -1px 0 color-mix(in srgb, var(--saevyn-aurora) 14%, transparent),\n        0 22px 60px color-mix(in srgb, var(--saevyn-bg) 58%, transparent) !important;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .user-message-bubble-color {\n    border-radius: 28px 28px 8px 28px !important;\n    background:\n        radial-gradient(ellipse at 20% 0%, color-mix(in srgb, var(--tp-foam) 12%, transparent), transparent 55%),\n        linear-gradient(160deg, var(--tp-wash), color-mix(in srgb, var(--saevyn-panel) 58%, transparent)) !important;\n    font-style: normal;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active form[data-type=\"unified-composer\"] [data-composer-surface=\"true\"] {\n    background:\n        radial-gradient(ellipse at 80% 110%, color-mix(in srgb, var(--saevyn-aurora) 14%, transparent), transparent 55%),\n        linear-gradient(160deg, color-mix(in srgb, var(--saevyn-panel) 74%, transparent), color-mix(in srgb, var(--saevyn-bg) 82%, transparent)) !important;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-flourish,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-tendril { display: none !important; }\n\n/* ---------- Sidebar: the tide line ---------- */\n\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active #stage-slideover-sidebar,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active #stage-popover-sidebar {\n    isolation: isolate;\n    border-inline-end: 1px solid var(--tp-line-soft) !important;\n    box-shadow: 14px 0 56px color-mix(in srgb, var(--saevyn-bg) 42%, transparent) !important;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active #stage-slideover-sidebar::before,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active #stage-popover-sidebar::before {\n    content: \"\";\n    display: block !important;\n    position: absolute;\n    inset: 0;\n    z-index: -1;\n    border: 0;\n    border-radius: 0;\n    background:\n        radial-gradient(circle at 100% 50%, transparent 7px, color-mix(in srgb, var(--tp-foam) 40%, transparent) 7px 8px, transparent 8.5px) right 0 top 0 / 10px 18px repeat-y,\n        radial-gradient(circle at 0% 50%, transparent 7px, color-mix(in srgb, var(--tp-foam) 22%, transparent) 7px 8px, transparent 8.5px) right 0 top 9px / 10px 18px repeat-y,\n        linear-gradient(90deg, transparent 60%, color-mix(in srgb, var(--tp-water) 18%, transparent)),\n        linear-gradient(180deg, var(--tp-wash), transparent 40%, color-mix(in srgb, var(--tp-water) 12%, transparent));\n    pointer-events: none;\n}\n\n/* ---------- Headers: ripple ring, wave hairline, bubble thread ---------- */\n\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-laurel,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-rose,\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-halo { display: none; }\nbody.saevyn-active .saevyn-ripple {\n    display: none;\n    position: absolute;\n    top: 23px;\n    left: 23px;\n    z-index: 0;\n    width: 92px;\n    height: 92px;\n    transform: translate(-50%, -50%);\n    color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 80%, white);\n    opacity: 0.45;\n    pointer-events: none;\n    animation: reverie-ripple-pulse 7s ease-out infinite;\n}\nhtml[data-saevyn-look=\"tidepool\"]:not([data-saevyn-density=\"quiet\"]) body.saevyn-active .saevyn-ripple { display: block; }\nhtml[data-saevyn-look=\"tidepool\"][data-saevyn-density=\"opulent\"] body.saevyn-active .saevyn-ripple { width: 108px; height: 108px; }\nhtml[data-saevyn-motion=\"still\"] body.saevyn-active .saevyn-ripple { animation: none; opacity: 0.35; }\n/* Engraved headers move the portrait out to the rail's left anchor. Keep the\n   Tidepool ripple on that same center instead of the hairline grid position. */\nhtml[data-saevyn-look=\"tidepool\"][data-saevyn-ornaments=\"engraved\"] body.saevyn-active .saevyn-ripple {\n    top: 25px;\n    left: -39px;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-portrait {\n    box-shadow:\n        0 0 0 2px color-mix(in srgb, var(--saevyn-bg) 92%, transparent),\n        0 0 0 3px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 62%, transparent),\n        inset 0 2px 0 color-mix(in srgb, var(--tp-foam) 30%, transparent),\n        0 10px 28px color-mix(in srgb, var(--saevyn-bg) 60%, transparent);\n}\n/* A scalloped wave instead of a straight hairline */\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-divider-assembly::before {\n    height: 14px;\n    background:\n        radial-gradient(circle at 50% 100%, transparent 5.5px, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 50%, transparent) 5.5px 6.5px, transparent 7px) 0 0 / 14px 7px repeat-x,\n        radial-gradient(circle at 50% 0%, transparent 5.5px, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 50%, transparent) 5.5px 6.5px, transparent 7px) 7px 7px / 14px 7px repeat-x;\n    -webkit-mask-image: linear-gradient(90deg, #000 40%, transparent);\n    mask-image: linear-gradient(90deg, #000 40%, transparent);\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-speaker-name {\n    letter-spacing: 0.3em !important;\n    color: color-mix(in srgb, var(--saevyn-aurora) 35%, var(--saevyn-text)) !important;\n}\n/* Light through water replaces speaker weather */\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-speaker-header::after {\n    background:\n        radial-gradient(ellipse 30% 60% at 30% 40%, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 16%, transparent), transparent 70%),\n        radial-gradient(ellipse 26% 50% at 62% 60%, color-mix(in srgb, var(--saevyn-aurora) 14%, transparent), transparent 70%);\n    background-size: 220px 100%, 180px 100%;\n    opacity: calc(var(--reverie-weather) * 1.3);\n    animation: reverie-water-drift 40s linear infinite alternate;\n}\n/* The thread beside a run becomes a string of small bubbles */\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-segment-content::before {\n    width: 5px;\n    left: -42px;\n    background: radial-gradient(circle at 50% 50%, transparent 1.4px, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 50%, transparent) 1.6px 2.2px, transparent 2.6px) 0 0 / 5px 11px repeat-y;\n}\n\n/* ---------- Type and details ---------- */\n\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active section[data-turn=\"assistant\"] .markdown blockquote {\n    border-left: 0 !important;\n    padding-left: 1.2rem;\n    background: radial-gradient(circle at 50% 50%, transparent 1.4px, var(--tp-line) 1.6px 2.2px, transparent 2.6px) 0 0 / 5px 11px repeat-y;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active section[data-turn=\"assistant\"] .markdown pre {\n    border-radius: 18px !important;\n    border-color: var(--tp-line-soft) !important;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) h2::before {\n    rotate: 0deg;\n    width: 7px;\n    height: 7px;\n    border-radius: 50%;\n    border: 1px solid var(--tp-foam);\n    background: transparent;\n    box-shadow: none;\n}\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active :is([role=\"tablist\"], [role=\"radiogroup\"]) { border-radius: 999px !important; }\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) a[data-sidebar-item=\"true\"]:not(#sidebar-header a) { border-radius: 18px !important; }\nhtml[data-saevyn-look=\"tidepool\"] body.saevyn-active [data-testid=\"accounts-profile-button\"] { border-radius: 20px !important; }\n\n@media (max-width: 720px) {\n    body.saevyn-active .saevyn-ripple { top: 19px; left: 19px; width: 74px; height: 74px; }\n    html[data-saevyn-look=\"tidepool\"] #saevyn-reverie-sky .jelly-3 { display: none; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n    #saevyn-reverie-sky :is(.caustics, .bubbles, .jelly),\n    body.saevyn-active .saevyn-ripple,\n    html[data-saevyn-look=\"tidepool\"] body.saevyn-active .saevyn-speaker-header::after { animation: none !important; }\n}\n\n/* =====================================================================\n   Responsive geometry for the alternate Reverie looks.\n\n   This file is deliberately appended after Cathedral, Nouveau, and\n   Tidepool. Those look layers own decoration; this layer owns fit. The\n   default Reverie look is excluded because its native geometry is already\n   correct and should not change when another look needs repair.\n   ===================================================================== */\n\n/* Every look may change the frame, but menus need a shared readability\n   floor. Mix two opaque theme colors instead of mixing either with\n   transparent, so moving conversation text cannot show through the menu. */\nbody.saevyn-active [role=\"menu\"][data-radix-menu-content],\nbody.saevyn-active .popover.shadow-short-composer:has(.__menu-item),\nbody.saevyn-active [role=\"listbox\"].popover:has([role=\"option\"]),\nbody.saevyn-active [data-testid=\"modal-global-search\"] > .popover,\nbody.saevyn-active [data-testid^=\"modal-\"] [role=\"dialog\"].popover,\nbody.saevyn-active dialog > [data-testid^=\"modal-\"],\nbody.saevyn-active [role=\"dialog\"]:has(input[aria-label=\"Search settings\"]) {\n    background:\n        linear-gradient(160deg,\n            color-mix(in srgb, var(--saevyn-panel) 94%, var(--saevyn-bg)),\n            color-mix(in srgb, var(--saevyn-bg) 92%, var(--saevyn-panel))) !important;\n    backdrop-filter: blur(30px) saturate(1.16) !important;\n    -webkit-backdrop-filter: blur(30px) saturate(1.16) !important;\n}\n\n@media (max-width: 1099px) {\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-header {\n        display: grid !important;\n        grid-template-columns: 48px minmax(0, 1fr) !important;\n        grid-template-rows: 32px auto !important;\n        grid-template-areas:\n            \"portrait assembly\"\n            \"portrait name\" !important;\n        align-items: center !important;\n        column-gap: 12px !important;\n        row-gap: 0 !important;\n        margin: 0.9rem 0 0.58rem !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-portrait {\n        position: relative !important;\n        inset: auto !important;\n        grid-area: portrait !important;\n        align-self: center !important;\n        justify-self: center !important;\n        width: 42px !important;\n        height: 42px !important;\n        margin: 0 !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-header::before {\n        top: 27px !important;\n        left: 24px !important;\n        width: 54px !important;\n        height: 54px !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-header > :is(.saevyn-laurel, .saevyn-rose, .saevyn-halo, .saevyn-ripple) {\n        top: 27px !important;\n        left: 24px !important;\n        width: 64px !important;\n        height: 64px !important;\n        scale: 0.72;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-divider-assembly {\n        grid-area: assembly !important;\n        grid-template-columns: 28px minmax(0, 1fr) 76px minmax(0, 1fr) 28px !important;\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 32px !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-divider-endpoint {\n        width: 28px !important;\n        height: 32px !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-divider-rail {\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 32px !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-mark,\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-emblem {\n        width: 76px !important;\n        height: 32px !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-name {\n        grid-area: name !important;\n        margin: -0.08rem 0 0 !important;\n        text-align: center !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-segment-content {\n        margin-inline-start: 0 !important;\n    }\n\n    html:not([data-saevyn-look=\"reverie\"])[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-segment-content::before {\n        display: none !important;\n    }\n}\n\n/* Phones return to the original ceremonial stack. This must stay after the\n   tablet rule above: the portrait belongs above the full covenant rail, not\n   in a narrow avatar column beside it. The selector intentionally covers\n   every look so changing themes never changes the mobile speaker geometry. */\n@media (max-width: 720px) {\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-header {\n        display: flex !important;\n        flex-direction: column !important;\n        align-items: stretch !important;\n        grid-template-columns: none !important;\n        grid-template-rows: none !important;\n        grid-template-areas: none !important;\n        row-gap: 0 !important;\n        margin: 1.2rem 0 0.72rem !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-portrait {\n        position: relative !important;\n        inset: auto !important;\n        align-self: center !important;\n        justify-self: auto !important;\n        width: 42px !important;\n        height: 42px !important;\n        margin: 0 0 0.42rem !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-header::before {\n        top: 21px !important;\n        left: 50% !important;\n        width: 58px !important;\n        height: 58px !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-header > :is(.saevyn-laurel, .saevyn-rose, .saevyn-halo, .saevyn-ripple) {\n        top: 21px !important;\n        left: 50% !important;\n        width: 64px !important;\n        height: 64px !important;\n        scale: 0.72;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-divider-assembly {\n        grid-area: auto !important;\n        grid-template-columns: 54px minmax(0, 1fr) 107px minmax(0, 1fr) 54px !important;\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 39px !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-divider-endpoint {\n        width: 54px !important;\n        height: 39px !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-divider-rail {\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 39px !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-mark,\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-emblem {\n        width: 107px !important;\n        height: 39px !important;\n    }\n\n    html[data-saevyn-look][data-saevyn-ornaments=\"engraved\"]\n        body.saevyn-active .saevyn-speaker-name {\n        grid-area: auto !important;\n        margin: -0.1rem 0 0 !important;\n        text-align: center !important;\n    }\n}\n";

    // ---------------------------------------------------------------------
    // Reverie runtime: the sky, filigree, speaker weather, living light,
    // ambient ornaments. Everything here is presentation only and
    // every injected node carries data-saevyn-generated so the engine's
    // mutation observer and clipboard guard treat it as Saevyn's own.
    // ---------------------------------------------------------------------
    const REVERIE_SYMBOLS_ID = "saevyn-reverie-symbols";
    const REVERIE_FILIGREE_TARGETS = [
        'form[data-type="unified-composer"] [data-composer-surface="true"]',
        ".user-message-bubble-color"
    ].join(", ");
    let filigreeRequest = 0;
    let typingTimer = 0;
    let flareTimer = 0;
    let reverieSettled = false;

    function mountReverieSky() {
        if (document.getElementById("saevyn-reverie-sky")) return;
        const sky = document.createElement("div");
        sky.id = "saevyn-reverie-sky";
        sky.dataset.saevynGenerated = "sky";
        sky.setAttribute("aria-hidden", "true");
        for (const className of ["orb orb-1", "orb orb-2", "orb orb-3", "orb orb-4", "glass", "caustics caustics--a", "caustics caustics--b", "stars stars--far", "stars stars--near", "bubbles", "jelly jelly-1", "jelly jelly-2", "jelly jelly-3", "candle", "veil"]) {
            const layer = document.createElement("i");
            layer.className = className;
            sky.append(layer);
        }
        sky.append(makeVines());
        (document.body || document.documentElement).append(sky);
    }

    // Art Nouveau sky: whiplash curves, two lilies, leaves, and tendrils.
    // Authored once as inline SVG so ChatGPT's image policy never sees it.
    function makeVines() {
        const namespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(namespace, "svg");
        svg.setAttribute("class", "vines");
        svg.setAttribute("viewBox", "0 0 1600 1000");
        svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const lily = (x, y, angle, size) =>
            `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${size})">` +
            '<path d="M0 0 c -34 -70 -12 -125 0 -160 c 12 35 34 90 0 160 z"/>' +
            '<path d="M0 0 c -34 -70 -12 -125 0 -160 c 12 35 34 90 0 160 z" transform="rotate(-38)" opacity="0.8"/>' +
            '<path d="M0 0 c -34 -70 -12 -125 0 -160 c 12 35 34 90 0 160 z" transform="rotate(38)" opacity="0.8"/>' +
            '<path d="M0 0 c -18 -30 -14 -60 -4 -80" opacity="0.6"/><path d="M0 0 c 18 -30 14 -60 4 -80" opacity="0.6"/>' +
            "</g>";
        const leaf = (x, y, angle, size) =>
            `<path d="M0 0 c 24 -38 70 -38 96 0 c -26 38 -72 38 -96 0 z M4 0 h 88" transform="translate(${x} ${y}) rotate(${angle}) scale(${size})"/>`;
        svg.innerHTML =
            '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
            '<path d="M -60 920 C 220 720, 150 420, 430 300 S 720 150, 940 -40"/>' +
            '<path d="M -60 980 C 280 780, 220 470, 500 360 S 790 230, 1010 30" stroke-width="1.1" opacity="0.7"/>' +
            '<path d="M 1660 90 C 1400 210, 1460 520, 1200 630 S 900 820, 1010 1060"/>' +
            '<path d="M 1660 150 C 1440 270, 1500 570, 1240 690 S 950 870, 1060 1060" stroke-width="1.1" opacity="0.7"/>' +
            '<path d="M 940 -40 c 36 24 14 70 -22 58 c -24 -8 -12 -34 8 -30 c 10 2 12 12 4 16"/>' +
            '<path d="M 1010 1060 c -40 -24 -18 -70 20 -58 c 24 8 12 34 -8 30 c -10 -2 -12 -12 -4 -16"/>' +
            '<path d="M 430 300 c -60 -10 -90 30 -70 70 c 14 28 44 20 40 -4 c -3 -16 -20 -14 -20 -2"/>' +
            "</g>" +
            '<g fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">' +
            lily(430, 300, -16, 0.9) + lily(1200, 630, 158, 0.8) +
            leaf(200, 700, -50, 0.9) + leaf(300, 560, -60, 0.7) + leaf(1380, 300, 120, 0.9) + leaf(1300, 480, 130, 0.7) + leaf(700, 180, -30, 0.6) +
            "</g>";
        return svg;
    }

    function ensureReverieSymbols() {
        if (document.getElementById(REVERIE_SYMBOLS_ID)) return;
        const namespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(namespace, "svg");
        svg.id = REVERIE_SYMBOLS_ID;
        svg.dataset.saevynGenerated = "symbols";
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";

        // A corner flourish: a bracket that softens into a spiral, two leaves,
        // and three seeds of light. Drawn once, reused mirrored in every corner.
        const flourish = document.createElementNS(namespace, "symbol");
        flourish.id = "saevyn-flourish";
        flourish.setAttribute("viewBox", "0 0 64 64");
        flourish.innerHTML = [
            '<path d="M1.5 46 V12 Q1.5 1.5 12 1.5 H46"/>',
            '<path d="M10 22 C 8 12, 22 6, 28 12 C 34 18, 26 28, 18 24 C 12 21, 16 14, 22 16"/>',
            '<path d="M30 6 c 8 -4 14 0 12 8 c -8 3 -13 -1 -12 -8 z" fill="currentColor" stroke="none" opacity="0.75"/>',
            '<path d="M6 30 c -4 8 0 14 8 12 c 3 -8 -1 -13 -8 -12 z" fill="currentColor" stroke="none" opacity="0.75"/>',
            '<circle cx="24" cy="24" r="1.6" fill="currentColor" stroke="none"/>',
            '<circle cx="52" cy="3" r="1.2" fill="currentColor" stroke="none"/>',
            '<circle cx="3" cy="52" r="1.2" fill="currentColor" stroke="none"/>'
        ].join("");

        // A laurel ring: thirty leaves of alternating size around a faint circle.
        const laurel = document.createElementNS(namespace, "symbol");
        laurel.id = "saevyn-laurel";
        laurel.setAttribute("viewBox", "0 0 100 100");
        let leaves = "";
        for (let index = 0; index < 30; index += 1) {
            const large = index % 2 === 0;
            const path = large ? "M50 3 q4 5 0 12 q-4 -7 0 -12 z" : "M50 5 q3 4 0 8 q-3 -4 0 -8 z";
            leaves += `<path d="${path}" transform="rotate(${index * 12} 50 50)" opacity="${large ? 0.95 : 0.7}"/>`;
        }
        laurel.innerHTML = `<g fill="currentColor" stroke="none">${leaves}</g><circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.45"/>`;

        // A rose window: eight pointed petals between an inner and outer ring,
        // with a seed of light between each petal. Cathedral Glass draws it
        // behind every portrait in place of the laurel.
        const rose = document.createElementNS(namespace, "symbol");
        rose.id = "saevyn-rose";
        rose.setAttribute("viewBox", "0 0 100 100");
        let petals = "";
        let seeds = "";
        for (let index = 0; index < 8; index += 1) {
            petals += `<path d="M50 35 Q59 22 50 7 Q41 22 50 35 z" transform="rotate(${index * 45} 50 50)"/>`;
            seeds += `<circle cx="50" cy="9" r="1.5" transform="rotate(${index * 45 + 22.5} 50 50)"/>`;
        }
        rose.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="0.9">${petals}<circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="42.5" opacity="0.55"/><circle cx="50" cy="50" r="16"/></g><g fill="currentColor" stroke="none">${seeds}</g>`;

        // A Mucha halo: outer ring, a beaded mosaic band, inner ring, and a
        // small lily at the crown. Art Nouveau draws it behind every portrait.
        const halo = document.createElementNS(namespace, "symbol");
        halo.id = "saevyn-halo";
        halo.setAttribute("viewBox", "0 0 100 100");
        halo.innerHTML =
            '<g fill="none" stroke="currentColor">' +
            '<circle cx="50" cy="50" r="47" stroke-width="0.9"/>' +
            '<circle cx="50" cy="50" r="42.5" stroke-width="3.2" stroke-dasharray="2.2 2.4" opacity="0.75"/>' +
            '<circle cx="50" cy="50" r="38.5" stroke-width="0.7" opacity="0.8"/>' +
            '<path d="M50 12 c -5 -7 -3 -13 0 -17 c 3 4 5 10 0 17 z" stroke-width="0.9"/>' +
            '<path d="M50 12 c -5 -7 -3 -13 0 -17 c 3 4 5 10 0 17 z" stroke-width="0.9" transform="rotate(-30 50 12)" opacity="0.8"/>' +
            '<path d="M50 12 c -5 -7 -3 -13 0 -17 c 3 4 5 10 0 17 z" stroke-width="0.9" transform="rotate(30 50 12)" opacity="0.8"/>' +
            '<path d="M42 11 c 4 -3 12 -3 16 0" stroke-width="0.8" opacity="0.7"/>' +
            "</g>" +
            '<g fill="currentColor" stroke="none"><circle cx="50" cy="13" r="1.1"/><circle cx="50" cy="88" r="1.3"/><circle cx="12" cy="50" r="1.1"/><circle cx="88" cy="50" r="1.1"/></g>';

        // A whiplash tendril for corners: an S-curve that ends in a bud, with a leaf.
        const tendril = document.createElementNS(namespace, "symbol");
        tendril.id = "saevyn-tendril";
        tendril.setAttribute("viewBox", "0 0 64 64");
        tendril.innerHTML =
            '<path d="M2 62 C 2 36, 12 22, 30 18 C 44 15, 52 22, 46 32 C 41 40, 30 36, 33 28 C 35 23, 41 24, 40 29"/>' +
            '<path d="M2 62 C 10 44, 26 40, 38 44 C 48 47, 52 56, 46 62" opacity="0.7"/>' +
            '<path d="M8 30 c 2 -12 12 -18 22 -14 c -2 12 -12 18 -22 14 z" fill="currentColor" stroke="none" opacity="0.55"/>' +
            '<path d="M46 32 c 6 -2 10 3 8 8 c -6 2 -10 -3 -8 -8 z" fill="currentColor" stroke="none" opacity="0.8"/>' +
            '<circle cx="4" cy="4" r="1.5" fill="currentColor" stroke="none"/>';

        // A ripple: concentric rings that fade outward. Tidepool pulses it
        // behind every portrait.
        const ripple = document.createElementNS(namespace, "symbol");
        ripple.id = "saevyn-ripple";
        ripple.setAttribute("viewBox", "0 0 100 100");
        ripple.innerHTML =
            '<g fill="none" stroke="currentColor">' +
            '<circle cx="50" cy="50" r="30" stroke-width="1.1"/>' +
            '<circle cx="50" cy="50" r="37" stroke-width="0.9" opacity="0.75"/>' +
            '<circle cx="50" cy="50" r="43" stroke-width="0.7" opacity="0.5"/>' +
            '<circle cx="50" cy="50" r="48" stroke-width="0.6" opacity="0.3"/>' +
            "</g>";

        svg.append(flourish, laurel, rose, halo, tendril, ripple);
        (document.body || document.documentElement).append(svg);
    }

    // Tidepool caustics: turbulence veins, sharpened into light, used as a
    // mask over the layer's own theme gradient so the water is theme-colored.
    function ensureTidepoolFilter() {
        if (document.getElementById("saevyn-tidepool-filters")) return;
        const namespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(namespace, "svg");
        svg.id = "saevyn-tidepool-filters";
        svg.dataset.saevynGenerated = "filters";
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
        svg.innerHTML =
            '<filter id="saevyn-caustics" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
            '<feTurbulence type="turbulence" baseFrequency="0.008 0.013" numOctaves="2" seed="8" stitchTiles="stitch" result="veins"/>' +
            '<feColorMatrix in="veins" type="luminanceToAlpha" result="lum"/>' +
            '<feComponentTransfer in="lum" result="light"><feFuncA type="gamma" amplitude="1.9" exponent="3.4" offset="-0.04"/></feComponentTransfer>' +
            '<feComposite in="SourceGraphic" in2="light" operator="in"/>' +
            "</filter>";
        (document.body || document.documentElement).append(svg);
    }

    function makeSymbolUse(symbolId, className) {
        const namespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(namespace, "svg");
        const use = document.createElementNS(namespace, "use");
        svg.setAttribute("class", className);
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        use.setAttribute("href", "#" + symbolId);
        svg.append(use);
        return svg;
    }

    function makeFiligreeFrame() {
        const frame = document.createElement("span");
        frame.className = "saevyn-filigree";
        frame.dataset.saevynGenerated = "filigree";
        frame.setAttribute("aria-hidden", "true");
        for (const corner of ["tl", "tr", "bl", "br"]) {
            frame.append(
                makeSymbolUse("saevyn-flourish", "saevyn-flourish saevyn-flourish--" + corner),
                makeSymbolUse("saevyn-tendril", "saevyn-tendril saevyn-tendril--" + corner)
            );
        }
        return frame;
    }

    function decorateSurfaces() {
        filigreeRequest = 0;
        if (!document.body || !document.body.classList.contains("saevyn-active")) return;
        ensureReverieSymbols();
        for (const target of document.querySelectorAll(REVERIE_FILIGREE_TARGETS)) {
            if (!target.querySelector(":scope > .saevyn-filigree")) target.append(makeFiligreeFrame());
        }
    }

    function queueFiligree() {
        if (filigreeRequest || paused) return;
        filigreeRequest = requestAnimationFrame(decorateSurfaces);
    }

    function removeFiligree() {
        for (const frame of document.querySelectorAll(".saevyn-filigree")) frame.remove();
    }

    function decorateHeader(header, assembly) {
        header.append(
            makeSymbolUse("saevyn-laurel", "saevyn-laurel"),
            makeSymbolUse("saevyn-rose", "saevyn-rose"),
            makeSymbolUse("saevyn-halo", "saevyn-halo"),
            makeSymbolUse("saevyn-ripple", "saevyn-ripple")
        );
        assembly.append(makeSymbolUse("saevyn-flourish", "saevyn-flourish saevyn-flourish--line"));
        if (reverieSettled) header.classList.add("saevyn-speaker-header--arriving");
    }

    function flareLantern() {
        const body = document.body;
        if (!body) return;
        body.classList.remove("saevyn-send-flare");
        void body.offsetWidth;
        body.classList.add("saevyn-send-flare");
        clearTimeout(flareTimer);
        flareTimer = setTimeout(() => body.classList.remove("saevyn-send-flare"), 1100);
    }

    function installLivingLight() {
        document.addEventListener("input", event => {
            if (!(event.target instanceof Element) || !event.target.closest("#prompt-textarea")) return;
            document.body.classList.add("saevyn-typing");
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => document.body.classList.remove("saevyn-typing"), 900);
        }, true);
        document.addEventListener("submit", event => {
            if (event.target instanceof Element && event.target.matches('form[data-type="unified-composer"]')) flareLantern();
        }, true);
        document.addEventListener("click", event => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest(
                'form[data-type="unified-composer"] :is([data-testid="send-button"], .composer-submit-button-color, button[type="submit"])'
            );
            if (button && !button.disabled) flareLantern();
        }, true);
        document.addEventListener("keydown", event => {
            if (
                event.key === "Enter" && !event.shiftKey && !event.isComposing &&
                event.target instanceof Element && event.target.closest("#prompt-textarea")
            ) flareLantern();
        }, true);
    }

    function installReverieRuntime() {
        ensureReverieSymbols();
        ensureTidepoolFilter();
        installLivingLight();
        queueFiligree();
        setTimeout(() => { reverieSettled = true; }, 3000);
    }

    function injectStyles() {
        if (document.getElementById("saevyn-styles")) return;

        const style = document.createElement("style");
        style.id = "saevyn-styles";
        style.dataset.saevynGenerated = "styles";
        const rawThemeCss = `
            html.saevyn-root {
                --saevyn-bg: #080609;
                --saevyn-sidebar: rgba(24, 8, 16, 0.985);
                --saevyn-sidebar-deep: rgba(11, 5, 9, 0.995);
                --saevyn-panel: rgba(28, 11, 19, 0.94);
                --saevyn-panel-subtle: rgba(28, 11, 19, 0.94);
                --saevyn-panel-selected: rgba(28, 11, 19, 0.94);
                --saevyn-border: rgba(154, 94, 112, 0.28);
                --saevyn-text: #eee4e7;
                --saevyn-muted: #ad9fa5;
                --saevyn-gold-shadow: #4b2e11;
                --saevyn-gold-deep: #75501f;
                --saevyn-gold: #c79b4f;
                --saevyn-gold-light: #efd58c;
                --saevyn-accent-fill: #c79b4f;
                --saevyn-accent-fill-hover: #ddb966;
                --saevyn-accent-fill-deep: #75501f;
                --saevyn-accent-ink: #1a1006;
                --saevyn-accent-text: #efd58c;
                --saevyn-accent-soft: rgba(199, 155, 79, 0.15);
                --saevyn-accent-press: rgba(199, 155, 79, 0.24);
                --saevyn-accent-outline: rgba(239, 213, 140, 0.52);
                --saevyn-line: rgba(199, 155, 79, 0.18);
                --saevyn-line-strong: rgba(199, 155, 79, 0.38);
                --saevyn-accent-wash: rgba(199, 155, 79, 0.10);
                --saevyn-glow: #6f2648;
                --saevyn-glow-deep: #48192f;
                --saevyn-accent-wash-strong: rgba(199, 155, 79, 0.24);

                /* Saevyn is an always-dark shell. ChatGPT's saved Light/System
                   preference may keep the light class on <html>; remap the
                   native contract while the skin is active so utility text,
                   icons, menus, and controls remain legible on our dark glass. */
                color-scheme: dark !important;
                --bg-primary: var(--saevyn-bg);
                --bg-elevated-primary: #160b11;
                --bg-secondary-surface: #160b11;
                --main-surface-background: rgba(8, 6, 9, 0.96);
                --main-surface-primary: var(--saevyn-bg);
                --main-surface-secondary: #160b11;
                --main-surface-tertiary: #25121b;
                --sidebar-surface: #180810;
                --sidebar-surface-primary: #180810;
                --sidebar-surface-secondary: #28121d;
                --sidebar-surface-tertiary: #381b29;
                --composer-surface-primary: #160b11;
                --composer-surface: rgba(22, 11, 17, 0.92);
                --text-primary: var(--saevyn-text);
                --text-secondary: #cdbdc2;
                --text-tertiary: var(--saevyn-muted);
                --text-quaternary: rgba(238, 228, 231, 0.52);
                --icon-primary: var(--saevyn-text);
                --icon-secondary: #cdbdc2;
                --icon-tertiary: var(--saevyn-muted);
                --border-default: rgba(239, 213, 140, 0.18);
                --border-light: rgba(154, 94, 112, 0.18);
                --border-sharp: rgba(154, 94, 112, 0.18);
                --surface-hover: rgba(199, 155, 79, 0.13);
                --interactive-bg-tertiary-default: #25121b;
                --interactive-bg-tertiary-inactive: #25121b;
                --interactive-bg-tertiary-selected: #311724;
                --interactive-button-label-default-secondary: var(--saevyn-text);
                --interactive-button-label-selected-secondary: #fff2cf;
                --interactive-button-icon-selected-secondary: #fff2cf;
                --interactive-icon-default-secondary: var(--saevyn-text);
                --interactive-icon-default-tertiary: #cdbdc2;
                --interactive-icon-hover-secondary: #fff2cf;
                --interactive-icon-hover-tertiary: #fff2cf;
                --interactive-label-default-tertiary: #cdbdc2;
                --interactive-label-secondary-selected: #fff2cf;

                /* ChatGPT's active theme contract, remapped to Saevyn gold. */
                --accent-blue: var(--saevyn-accent-fill);
                --bg-accent-static: var(--saevyn-accent-fill);
                --icon-accent: var(--saevyn-accent-text);
                --text-accent: var(--saevyn-accent-text);
                --selection: rgba(199, 155, 79, 0.52);
                --theme-accent-pill-bg-hover: rgba(117, 80, 31, 0.94);
                --theme-accent-pill-bg-rest: rgba(75, 46, 17, 0.92);
                --theme-accent-pill-text-hover: #fff2c9;
                --theme-accent-pill-text-rest: var(--saevyn-accent-text);
                --theme-accent-text: var(--saevyn-accent-text);
                --theme-chart-color: var(--saevyn-accent-fill);
                --theme-entity-accent: var(--saevyn-accent-text);
                --theme-secondary-btn-bg: var(--saevyn-accent-fill-deep);
                --theme-secondary-btn-text: #fff2cf;
                --theme-submit-btn-bg: var(--saevyn-accent-fill);
                --theme-submit-btn-text: var(--saevyn-accent-ink);
                --theme-user-msg-bg: rgba(92, 61, 24, 0.94);
                --theme-user-msg-text: #fff3d3;
                --theme-user-selection-bg: rgba(199, 155, 79, 0.48);

                --interactive-bg-accent-hover: var(--saevyn-accent-soft);
                --interactive-bg-accent-inactive: transparent;
                --interactive-bg-accent-muted-press: rgba(117, 80, 31, 0.36);
                --interactive-bg-accent-press: var(--saevyn-accent-press);
                --interactive-bg-accent-secondary-default: var(--saevyn-accent-fill);
                --interactive-bg-accent-secondary-hover: var(--saevyn-accent-fill-hover);
                --interactive-bg-accent-secondary-inactive: transparent;
                --interactive-bg-default-accent-secondary: var(--saevyn-accent-fill);
                --interactive-bg-hover-accent: var(--saevyn-accent-soft);
                --interactive-bg-hover-accent-secondary: var(--saevyn-accent-fill-hover);
                --interactive-bg-inactive-accent: transparent;
                --interactive-bg-press-accent: var(--saevyn-accent-press);
                --interactive-bg-press-accent-secondary: var(--saevyn-accent-fill-deep);
                --interactive-bg-selected-accent: var(--saevyn-accent-soft);
                --interactive-bg-selected-accent-secondary: var(--saevyn-accent-fill);

                --interactive-button-bg-default-accent: transparent;
                --interactive-button-bg-hover-accent: var(--saevyn-accent-soft);
                --interactive-button-bg-inactive-accent: transparent;
                --interactive-button-bg-press-accent: var(--saevyn-accent-press);
                --interactive-button-border-default-accent: transparent;
                --interactive-button-border-inactive-accent: transparent;
                --interactive-button-border-press-accent: transparent;
                --interactive-button-border-selected-accent: transparent;
                --interactive-button-icon-default-accent: var(--saevyn-accent-text);
                --interactive-button-icon-hover-accent: #fff2c9;
                --interactive-button-icon-inactive-accent: rgba(239, 213, 140, 0.54);
                --interactive-button-icon-press-accent: #fff2c9;
                --interactive-button-icon-selected-accent: var(--saevyn-accent-text);
                --interactive-button-label-default-accent: var(--saevyn-accent-text);
                --interactive-button-label-hover-accent: #fff2c9;
                --interactive-button-label-press-accent: #fff2c9;
                --interactive-button-label-selected-accent: var(--saevyn-accent-text);
                --interactive-button-outline-focus-accent: var(--saevyn-accent-outline);

                --interactive-icon-accent-default: var(--saevyn-accent-text);
                --interactive-icon-accent-hover: #fff2c9;
                --interactive-icon-accent-inactive: rgba(239, 213, 140, 0.54);
                --interactive-icon-accent-press: #fff2c9;
                --interactive-icon-accent-selected: var(--saevyn-accent-text);
                --interactive-icon-default-accent: var(--saevyn-accent-text);
                --interactive-icon-inactive-accent: rgba(239, 213, 140, 0.54);
                --interactive-icon-press-accent: #fff2c9;
                --interactive-label-accent-accessible: #fff2c9;
                --interactive-label-accent-default: var(--saevyn-accent-text);
                --interactive-label-accent-hover: #fff2c9;
                --interactive-label-accent-inactive: rgba(239, 213, 140, 0.54);
                --interactive-label-accent-press: #fff2c9;
                --interactive-label-accent-selected: var(--saevyn-accent-text);
                --interactive-label-default-accent: var(--saevyn-accent-text);
                --interactive-label-inactive-accent: rgba(239, 213, 140, 0.54);
                background: var(--saevyn-bg) !important;
                color-scheme: dark;
            }

            body.saevyn-active,
            body.saevyn-active :is(button, input, textarea, select, option) {
                font-family: var(--saevyn-ui-font, system-ui, sans-serif) !important;
            }

            body.saevyn-active .saevyn-message-body .markdown,
            body.saevyn-active .saevyn-speaker-name {
                font-family: var(--saevyn-message-font, ui-serif, Georgia, serif) !important;
            }

            body.saevyn-active .saevyn-speaker-name::before {
                content: attr(data-saevyn-speaker-label);
            }

            body.saevyn-active .saevyn-message-body :is(pre, code, kbd, samp) {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
            }

            body.saevyn-active {
                position: relative;
                isolation: isolate;
                background: transparent !important;
                color: var(--saevyn-text);
            }

            body.saevyn-active::before,
            body.saevyn-active::after {
                content: "";
                position: fixed;
                inset: -24px;
                pointer-events: none;
                transform: translateZ(0) scale(1.025);
            }

            body.saevyn-active::before {
                z-index: -2;
                background-color: var(--saevyn-bg);
                background-image: var(--saevyn-background-image);
                background-position: center;
                background-repeat: no-repeat;
                background-size: cover;
                opacity: var(--saevyn-background-opacity, 0.22);
                filter: blur(var(--saevyn-background-blur, 0px));
            }

            body.saevyn-active::after {
                z-index: -1;
                background:
                    radial-gradient(ellipse 64% 40% at 50% 104%, color-mix(in srgb, var(--saevyn-glow) 34%, transparent), transparent 100%),
                    radial-gradient(ellipse 82% 72% at 50% 40%, transparent 56%, rgba(0, 0, 0, 0.32) 100%),
                    radial-gradient(circle at 78% 10%, rgba(86, 25, 72, 0.17), transparent 38%),
                    radial-gradient(circle at 12% 76%, rgba(89, 38, 48, 0.15), transparent 42%),
                    rgba(7, 5, 8, var(--saevyn-overlay-opacity, 0.78));
            }

            body.saevyn-active.saevyn-grain::after {
                filter: url("#saevyn-grain");
            }

            body.saevyn-active #main,
            body.saevyn-active #main [class*="bg-token-main-surface"] {
                background-color: transparent !important;
            }

            body.saevyn-active #stage-slideover-sidebar,
            body.saevyn-active #stage-popover-sidebar {
                border-inline-end: 1px solid rgba(204, 158, 82, 0.48) !important;
                background:
                    radial-gradient(circle at 72% 12%, rgba(95, 27, 57, 0.18), transparent 35%),
                    linear-gradient(180deg, var(--saevyn-sidebar), var(--saevyn-sidebar-deep)) !important;
                box-shadow:
                    inset -1px 0 rgba(255, 226, 164, 0.05),
                    8px 0 34px rgba(0, 0, 0, 0.28) !important;
                color: #dfd2d6;
            }

            body.saevyn-active #stage-slideover-sidebar {
                position: relative;
            }

            /* ChatGPT reserves a narrow transparent margin before thread content. */
            /* Continue the sidebar atmosphere through it instead of exposing raw black. */
            body.saevyn-active #stage-slideover-sidebar + div::before {
                content: "";
                position: absolute;
                z-index: 0;
                top: 0;
                bottom: 0;
                left: 0;
                width: 24px;
                background: linear-gradient(90deg, rgba(29, 9, 19, 0.78), rgba(15, 7, 12, 0.31) 56%, transparent);
                pointer-events: none;
            }

            body.saevyn-active #stage-slideover-sidebar::before,
            body.saevyn-active #stage-popover-sidebar::before {
                content: "";
                position: absolute;
                z-index: 40;
                inset: 5px;
                border: 1px solid rgba(207, 160, 78, 0.16);
                border-radius: 7px;
                pointer-events: none;
            }

            body.saevyn-active #stage-slideover-sidebar > *,
            body.saevyn-active #stage-popover-sidebar > * {
                position: relative;
                z-index: 1;
            }

            body.saevyn-active #stage-slideover-sidebar [class*="bg-token-sidebar-surface"],
            body.saevyn-active #stage-popover-sidebar [class*="bg-token-sidebar-surface"] {
                background-color: transparent !important;
            }

            body.saevyn-active #stage-slideover-sidebar [data-testid="create-new-chat-button"],
            body.saevyn-active #stage-popover-sidebar [data-testid="create-new-chat-button"] {
                position: relative;
                margin-inline-start: 0.42rem !important;
                width: calc(100% - 0.42rem) !important;
                background:
                    radial-gradient(circle at 70% 0%, rgba(89, 25, 55, 0.13), transparent 54%),
                    linear-gradient(180deg, rgba(24, 8, 16, 0.998), rgba(18, 7, 13, 0.998)) !important;
                box-shadow: 0 13px 18px -17px rgba(231, 190, 109, 0.34);
                isolation: isolate;
                z-index: 20;
            }

            body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar)
                nav > div:has(> ul > li > [data-testid="create-new-chat-button"]) {
                background:
                    radial-gradient(circle at 70% 0%, rgba(89, 25, 55, 0.13), transparent 54%),
                    linear-gradient(180deg, rgba(24, 8, 16, 0.999), rgba(18, 7, 13, 0.999)) !important;
                box-shadow: 0 13px 18px -17px rgba(231, 190, 109, 0.34);
                isolation: isolate;
                z-index: 20;
            }

            body.saevyn-active #stage-slideover-sidebar [data-testid="create-new-chat-button"]::after,
            body.saevyn-active #stage-popover-sidebar [data-testid="create-new-chat-button"]::after {
                content: "";
                position: absolute;
                right: 12px;
                bottom: 0;
                left: 12px;
                height: 1px;
                background: linear-gradient(
                    90deg,
                    transparent,
                    rgba(199, 155, 79, 0.44) 22%,
                    rgba(239, 213, 140, 0.58) 50%,
                    rgba(199, 155, 79, 0.44) 78%,
                    transparent
                );
                box-shadow: 0 2px 9px rgba(199, 155, 79, 0.13);
                pointer-events: none;
            }

            body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) [class~="group/sidebar-expando-section-header"] {
                position: relative;
                margin: 0.42rem 0.68rem 0.30rem;
                padding-bottom: 0.30rem;
                isolation: isolate;
            }

            body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) [class~="group/sidebar-expando-section-header"]::after {
                content: "";
                position: absolute;
                right: 0.22rem;
                bottom: 0;
                left: 0.22rem;
                height: 1px;
                background: linear-gradient(
                    90deg,
                    transparent,
                    rgba(199, 155, 79, 0.25) 14%,
                    rgba(239, 213, 140, 0.50) 50%,
                    rgba(199, 155, 79, 0.25) 86%,
                    transparent
                );
                box-shadow: 0 2px 8px rgba(199, 155, 79, 0.10);
                pointer-events: none;
            }

            body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) [class~="group/sidebar-expando-section-header"] h2.__menu-label {
                color: var(--saevyn-gold-light) !important;
                font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
                font-size: 0.78rem;
                font-weight: 650;
                letter-spacing: 0.055em;
                text-transform: uppercase;
            }

            body.saevyn-active #stage-slideover-sidebar nav > div:has(#sidebar-header),
            body.saevyn-active #stage-popover-sidebar nav > div:has(#sidebar-header) {
                background:
                    radial-gradient(circle at 18% 0%, rgba(104, 31, 62, 0.19), transparent 58%),
                    linear-gradient(180deg, rgba(27, 9, 18, 0.999), rgba(22, 8, 15, 0.998)) !important;
                border-bottom: 1px solid rgba(207, 160, 78, 0.10);
                box-shadow: 0 11px 20px -19px rgba(231, 190, 109, 0.30);
                isolation: isolate;
                z-index: 30;
            }

            body.saevyn-active #sidebar-header a[data-sidebar-item="true"][href="/"] {
                background: transparent !important;
                border: 0 !important;
                box-shadow: none !important;
            }

            body.saevyn-active #sidebar-header a[data-sidebar-item="true"][href="/"] .header-wordmark {
                display: inline-flex;
                align-items: center;
                gap: 0.46rem;
            }

            body.saevyn-active #sidebar-header a[data-sidebar-item="true"][href="/"] .header-wordmark::before {
                content: "";
                display: block;
                width: 28px;
                height: 28px;
                flex: 0 0 28px;
                max-width: none;
                background: center / contain no-repeat none;
                filter:
                    drop-shadow(0 0 3px rgba(199, 155, 79, 0.28))
                    drop-shadow(0 2px 5px rgba(0, 0, 0, 0.38));
                pointer-events: none;
            }

            body.saevyn-active #stage-sidebar-tiny-bar button:has(use[href*="#blossom"]) {
                position: relative;
            }

            body.saevyn-active #stage-sidebar-tiny-bar button:has(use[href*="#blossom"])::before {
                content: "";
                position: absolute;
                z-index: 1;
                width: 27px;
                height: 27px;
                background: center / contain no-repeat none;
                filter:
                    drop-shadow(0 0 3px rgba(199, 155, 79, 0.28))
                    drop-shadow(0 2px 5px rgba(0, 0, 0, 0.38));
                opacity: 1;
                transition: opacity 140ms ease;
                pointer-events: none;
            }

            body.saevyn-active #stage-sidebar-tiny-bar button:has(use[href*="#blossom"])
                svg:has(use[href*="#blossom"]) {
                opacity: 0 !important;
            }

            body.saevyn-active #stage-sidebar-tiny-bar button:has(use[href*="#blossom"]):is(:hover, :focus-visible)::before {
                opacity: 0;
            }

            @media (max-width: 767px) {
                body.saevyn-active #sidebar-header a[data-sidebar-item="true"][href="/"] {
                    display: inline-flex;
                    align-items: center;
                    justify-content: flex-start;
                    margin-inline-start: 8px !important;
                    padding: 0 !important;
                    background: transparent !important;
                    border: 0 !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                }

                body.saevyn-active #sidebar-header a[data-sidebar-item="true"][href="/"]::before {
                    content: "";
                    display: block;
                    width: 27px;
                    height: 27px;
                    background: center / contain no-repeat none;
                    filter:
                        drop-shadow(0 0 3px rgba(199, 155, 79, 0.28))
                        drop-shadow(0 2px 5px rgba(0, 0, 0, 0.38));
                    pointer-events: none;
                }

                body.saevyn-active #sidebar-header a[data-sidebar-item="true"][href="/"] :is(.header-wordmark, svg) {
                    display: none !important;
                }
            }

            body.saevyn-active #stage-slideover-sidebar div:has(> div > [data-testid="accounts-profile-button"]),
            body.saevyn-active #stage-popover-sidebar div:has(> div > [data-testid="accounts-profile-button"]) {
                background:
                    radial-gradient(circle at 20% 100%, rgba(97, 31, 59, 0.17), transparent 58%),
                    linear-gradient(180deg, rgba(18, 7, 13, 0.998), rgba(25, 9, 17, 0.999)) !important;
                border-top: 1px solid rgba(207, 160, 78, 0.14);
                box-shadow: 0 -12px 21px -20px rgba(231, 190, 109, 0.34);
                isolation: isolate;
                z-index: 30;
            }

            body.saevyn-active [data-testid="accounts-profile-button"] {
                border: 1px solid rgba(186, 131, 81, 0.12) !important;
                background: rgba(80, 29, 50, 0.20) !important;
            }

            body.saevyn-active [data-testid="accounts-profile-button"][data-state="open"] {
                border-color: rgba(211, 159, 91, 0.24) !important;
                background: rgba(91, 35, 57, 0.34) !important;
            }

            body.saevyn-active [data-testid="accounts-profile-button"]
                [data-trailing-button] .btn-secondary {
                border: 1px solid rgba(255, 231, 172, 0.34) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 242, 201, 0.22), transparent 54%),
                    linear-gradient(180deg, var(--saevyn-accent-fill-hover), var(--saevyn-accent-fill)) !important;
                color: var(--saevyn-accent-ink) !important;
                box-shadow:
                    inset 0 1px 0 rgba(255, 247, 221, 0.25),
                    0 3px 10px rgba(75, 46, 17, 0.22) !important;
            }

            body.saevyn-active [data-testid="accounts-profile-button"]
                [data-trailing-button]:is(:hover, :focus-visible) .btn-secondary {
                border-color: rgba(255, 242, 201, 0.58) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 248, 226, 0.28), transparent 54%),
                    linear-gradient(180deg, #efd58c, var(--saevyn-accent-fill-hover)) !important;
                color: #140c04 !important;
            }

            body.saevyn-active [role="menu"][data-radix-menu-content] {
                border: 1px solid rgba(207, 160, 78, 0.22) !important;
                background:
                    radial-gradient(circle at 16% 0%, rgba(111, 38, 72, 0.20), transparent 48%),
                    linear-gradient(180deg, rgba(31, 12, 22, 0.998), rgba(13, 7, 11, 0.999)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.025),
                    0 18px 42px rgba(0, 0, 0, 0.52) !important;
                color: #eee3e7 !important;
            }

            /* ChatGPT's 2026-09 composer attachment panel is no longer a
               Radix role=menu surface. Its own bg-token class is deliberately
               transparent inside #main, so give this specific composer
               popover an opaque reading surface without touching search or
               model-picker popovers. */
            body.saevyn-active .popover.shadow-short-composer:has(.__menu-item) {
                border: 1px solid rgba(207, 160, 78, 0.30) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(111, 38, 72, 0.24), transparent 46%),
                    linear-gradient(180deg, rgb(31, 12, 22), rgb(13, 7, 11)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.035),
                    0 18px 42px rgba(0, 0, 0, 0.58) !important;
                color: #eee3e7 !important;
                backdrop-filter: none !important;
            }

            body.saevyn-active .popover.shadow-short-composer:has(.__menu-item) .__menu-item {
                border: 1px solid transparent !important;
                color: #e9dde1 !important;
            }

            body.saevyn-active .popover.shadow-short-composer:has(.__menu-item)
                .__menu-item:is(:hover, :focus-visible, [data-highlighted], [data-state="open"]) {
                border-color: rgba(213, 164, 82, 0.20) !important;
                background: rgba(89, 31, 55, 0.62) !important;
                color: #fff0c7 !important;
            }

            /* Profile content is portaled beside body and OpenAI's current
               menu items carry their own transparent/native interaction
               contract. Keep the inside of the lower account menu visibly
               Saevyn as well as its outer shell. */
            body.saevyn-active:has(
                [data-testid="accounts-profile-button"][data-state="open"]
            ) [role="menu"][data-radix-menu-content] [role="menuitem"] {
                border: 1px solid transparent !important;
                color: #e6d9dd !important;
            }

            body.saevyn-active:has(
                [data-testid="accounts-profile-button"][data-state="open"]
            ) [role="menu"][data-radix-menu-content] [role="menuitem"]:is(
                :hover,
                :focus-visible,
                [data-highlighted],
                [data-state="open"]
            ) {
                border-color: rgba(213, 164, 82, 0.18) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(143, 55, 91, 0.25), transparent 58%),
                    linear-gradient(90deg, rgba(88, 30, 54, 0.55), rgba(49, 18, 33, 0.42)) !important;
                color: #fff0c7 !important;
            }

            body.saevyn-active:has(
                [data-testid="accounts-profile-button"][data-state="open"]
            ) [role="menu"][data-radix-menu-content] [role="separator"] {
                background: linear-gradient(90deg, transparent, rgba(207, 160, 78, 0.26), transparent) !important;
            }

            body.saevyn-active [role="menu"][data-radix-menu-content]:has(
                [data-testid="voice-play-turn-action-button"]
            ) [role="menuitem"]:not(.__menu-label) {
                color: var(--saevyn-gold) !important;
            }

            body.saevyn-active [role="menu"][data-radix-menu-content]:has(
                [data-testid="voice-play-turn-action-button"]
            ) [role="menuitem"]:not(.__menu-label):is(:hover, :focus-visible, [data-highlighted]) {
                background: rgba(89, 31, 55, 0.52) !important;
                color: var(--saevyn-gold-light) !important;
            }

            body.saevyn-active [role="menu"][data-radix-menu-content]:has(
                [data-testid="voice-play-turn-action-button"]
            ) [role="menuitem"].__menu-label {
                color: rgba(230, 201, 139, 0.68) !important;
            }

            body.saevyn-active [data-testid="modal-global-search"] > .popover {
                border: 1px solid rgba(213, 164, 82, 0.34) !important;
                background:
                    radial-gradient(circle at 10% 0%, rgba(118, 39, 75, 0.23), transparent 44%),
                    linear-gradient(145deg, rgba(31, 12, 22, 0.998), rgba(12, 7, 11, 0.999) 72%) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.03),
                    0 28px 78px rgba(0, 0, 0, 0.68) !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [data-testid="modal-global-search"] [role="search"] {
                background: transparent !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [data-testid="modal-global-search"] input[name="global-search"] {
                border-bottom: 1px solid rgba(207, 160, 78, 0.18) !important;
                background: rgba(8, 5, 8, 0.48) !important;
                color: #f1e5e9 !important;
            }

            body.saevyn-active [data-testid="modal-global-search"] input[name="global-search"]:focus {
                border-color: rgba(232, 195, 119, 0.46) !important;
                box-shadow: inset 0 -1px 0 rgba(232, 195, 119, 0.26) !important;
            }

            body.saevyn-active .btn-primary:not(:disabled) {
                border: 1px solid rgba(220, 174, 91, 0.38) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(139, 57, 91, 0.30), transparent 58%),
                    linear-gradient(180deg, rgba(92, 32, 56, 0.92), rgba(48, 17, 31, 0.96)) !important;
                box-shadow:
                    inset 0 0 12px rgba(147, 64, 96, 0.12),
                    0 6px 16px rgba(0, 0, 0, 0.24) !important;
                color: #f5e9ec !important;
            }

            body.saevyn-active .btn-primary:not(:disabled):hover {
                border-color: rgba(238, 200, 126, 0.56) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(159, 68, 103, 0.35), transparent 58%),
                    linear-gradient(180deg, rgba(108, 39, 65, 0.94), rgba(57, 20, 37, 0.98)) !important;
            }

            /* Shared application-page controls: Library, Scheduled, Plugins, Images, Sites, and GPT discovery. */
            body.saevyn-active :is(
                input[class~="bg-token-bg-primary"],
                input[role="combobox"]
            ) {
                border-color: rgba(210, 161, 81, 0.34) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(116, 38, 72, 0.18), transparent 52%),
                    linear-gradient(180deg, rgba(35, 13, 23, 0.94), rgba(17, 8, 13, 0.98)) !important;
                color: #eee2e6 !important;
                caret-color: #f0c66d !important;
                box-shadow: inset 0 0 0 1px rgba(255, 231, 172, 0.022) !important;
            }

            body.saevyn-active :is(
                input[class~="bg-token-bg-primary"],
                input[role="combobox"]
            ):focus {
                border-color: rgba(238, 200, 126, 0.58) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.045),
                    0 0 0 2px rgba(199, 155, 79, 0.08) !important;
            }

            body.saevyn-active :is([role="tablist"], [role="radiogroup"]) {
                border: 1px solid rgba(204, 156, 84, 0.24) !important;
                border-radius: 999px !important;
                background:
                    radial-gradient(circle at 20% 0%, rgba(114, 37, 70, 0.20), transparent 58%),
                    linear-gradient(180deg, rgba(31, 11, 21, 0.88), rgba(15, 7, 11, 0.94)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.024),
                    0 5px 14px rgba(0, 0, 0, 0.20) !important;
            }

            body.saevyn-active :is([role="tab"], [role="radio"]) {
                border: 1px solid transparent !important;
                border-radius: 999px !important;
                background: transparent !important;
                color: #cdbfc4 !important;
            }

            body.saevyn-active :is(
                [role="tab"][aria-selected="true"],
                [role="radio"][aria-checked="true"]
            ) {
                border-color: rgba(211, 139, 157, 0.34) !important;
                background:
                    radial-gradient(circle at 16% 0%, rgba(153, 64, 99, 0.31), transparent 58%),
                    linear-gradient(180deg, rgba(91, 31, 55, 0.82), rgba(52, 18, 33, 0.90)) !important;
                color: #f7e9ed !important;
                box-shadow: inset 0 0 13px rgba(155, 67, 100, 0.10) !important;
            }

            body.saevyn-active .btn-primary-inverse,
            body.saevyn-active .btn-ghost[aria-pressed="true"] {
                border: 1px solid rgba(215, 167, 91, 0.38) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(148, 58, 94, 0.28), transparent 58%),
                    linear-gradient(180deg, rgba(86, 30, 52, 0.88), rgba(47, 17, 30, 0.94)) !important;
                color: #fff0c7 !important;
                box-shadow: inset 0 0 11px rgba(154, 66, 99, 0.09) !important;
            }

            body.saevyn-active :is(
                button[class~="bg-token-bg-primary"],
                [class~="bg-token-bg-secondary"]
            ) {
                border-color: rgba(204, 156, 84, 0.26) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(115, 37, 71, 0.21), transparent 54%),
                    linear-gradient(145deg, rgba(42, 15, 28, 0.94), rgba(20, 9, 15, 0.97)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.022),
                    0 7px 18px rgba(0, 0, 0, 0.20) !important;
                color: #eadde1 !important;
            }

            body.saevyn-active [class~="bg-token-bg-secondary"]:is(:hover, :focus-visible) {
                border-color: rgba(225, 181, 99, 0.43) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(146, 54, 91, 0.28), transparent 56%),
                    linear-gradient(145deg, rgba(56, 20, 36, 0.96), rgba(26, 10, 18, 0.98)) !important;
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky:has(.btn-primary-inverse) {
                border-block: 1px solid rgba(204, 156, 84, 0.16) !important;
                background:
                    radial-gradient(circle at 50% 0%, rgba(105, 32, 65, 0.14), transparent 44%),
                    linear-gradient(180deg, rgba(24, 9, 17, 0.92), rgba(13, 6, 10, 0.95)) !important;
                box-shadow:
                    inset 0 1px rgba(255, 231, 172, 0.018),
                    0 8px 19px -18px rgba(231, 190, 109, 0.46) !important;
                backdrop-filter: blur(12px);
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky:has(.btn-primary-inverse)
                [class~="bg-surface-primary"] {
                background: transparent !important;
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky
                :is(.btn-ghost[aria-pressed="true"]) {
                position: relative;
                z-index: 1;
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky:has(.btn-ghost[aria-pressed="true"]) {
                border-block: 1px solid rgba(204, 156, 84, 0.16) !important;
                background:
                    radial-gradient(circle at 50% 0%, rgba(105, 32, 65, 0.14), transparent 44%),
                    linear-gradient(180deg, rgba(24, 9, 17, 0.92), rgba(13, 6, 10, 0.95)) !important;
                box-shadow:
                    inset 0 1px rgba(255, 231, 172, 0.018),
                    0 8px 19px -18px rgba(231, 190, 109, 0.46) !important;
                backdrop-filter: blur(12px);
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky:has(.btn-ghost[aria-pressed="true"])
                [class~="bg-surface-primary"] {
                background: transparent !important;
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky.flex.flex-col:has(input[role="combobox"]) {
                border: 0 !important;
                border-radius: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
            }

            body.saevyn-active [class~="bg-token-bg-primary"].sticky.flex.flex-col:has(input[role="combobox"])
                > [class~="bg-token-bg-primary"].sticky {
                border: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
            }

            body.saevyn-active [data-testid="pricing-modal-non-footer-content"] {
                background:
                    radial-gradient(circle at 50% 0%, rgba(104, 31, 64, 0.16), transparent 38%),
                    radial-gradient(circle at 18% 72%, rgba(73, 24, 49, 0.12), transparent 40%),
                    linear-gradient(180deg, rgba(12, 6, 10, 0.995), rgba(7, 4, 7, 0.999)) !important;
                color: #eadde1 !important;
                scrollbar-color: rgba(192, 140, 73, 0.48) transparent;
            }

            body.saevyn-active :is(
                [data-testid="plus-pricing-modal-column"],
                [data-testid="team-pricing-modal-column"],
                [data-testid="pro-pricing-modal-column"]
            ) {
                overflow: hidden;
                border: 1px solid rgba(210, 161, 81, 0.34) !important;
                border-radius: 18px !important;
                background:
                    radial-gradient(circle at 16% 0%, rgba(126, 41, 77, 0.24), transparent 52%),
                    linear-gradient(155deg, rgba(47, 16, 30, 0.97), rgba(20, 8, 14, 0.995) 72%) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.027),
                    0 15px 35px rgba(0, 0, 0, 0.30) !important;
                color: #eadde1 !important;
            }

            body.saevyn-active [data-testid="team-pricing-modal-column"] {
                border-color: rgba(232, 190, 104, 0.52) !important;
                background:
                    radial-gradient(circle at 50% -8%, rgba(166, 67, 105, 0.30), transparent 48%),
                    radial-gradient(circle at 12% 58%, rgba(103, 34, 68, 0.18), transparent 46%),
                    linear-gradient(155deg, rgba(61, 20, 38, 0.985), rgba(24, 9, 17, 0.998) 72%) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.045),
                    0 0 0 3px rgba(199, 155, 79, 0.055),
                    0 18px 40px rgba(0, 0, 0, 0.36) !important;
            }

            body.saevyn-active [data-testid="select-plan-button-teams-create"] {
                border: 1px solid rgba(255, 236, 181, 0.62) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 247, 218, 0.28), transparent 54%),
                    linear-gradient(180deg, var(--saevyn-accent-fill-hover), var(--saevyn-accent-fill)) !important;
                color: var(--saevyn-accent-ink) !important;
                box-shadow:
                    inset 0 1px rgba(255, 248, 224, 0.34),
                    0 6px 17px rgba(91, 56, 19, 0.25) !important;
            }

            body.saevyn-active [data-testid="select-plan-button-teams-create"]:is(:hover, :focus-visible) {
                border-color: rgba(255, 244, 207, 0.82) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 251, 235, 0.34), transparent 54%),
                    linear-gradient(180deg, #f1d992, #c79643) !important;
                color: #140c04 !important;
            }

            body.saevyn-active [data-testid="select-plan-button-plus-upgrade"] {
                border-color: rgba(204, 156, 84, 0.20) !important;
                background: rgba(53, 20, 34, 0.42) !important;
                color: #b7a8ad !important;
            }

            body.saevyn-active button[aria-label="Close upgrade plan modal"] {
                border: 1px solid rgba(211, 163, 84, 0.32) !important;
                background: rgba(60, 22, 38, 0.62) !important;
                color: #f3e6b8 !important;
                box-shadow: 0 5px 14px rgba(0, 0, 0, 0.24) !important;
                opacity: 1 !important;
            }

            body.saevyn-active button[aria-label="Close upgrade plan modal"]:is(:hover, :focus-visible) {
                border-color: rgba(236, 196, 113, 0.58) !important;
                background: rgba(92, 33, 55, 0.78) !important;
                color: #fff1c8 !important;
            }

            body.saevyn-active .group.relative > .w-full.text-start
                > [class~="bg-token-bg-primary"][class~="border-token-border-light"] {
                border-color: rgba(204, 156, 84, 0.28) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(123, 40, 75, 0.24), transparent 55%),
                    linear-gradient(145deg, rgba(48, 17, 31, 0.96), rgba(23, 9, 16, 0.99)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.025),
                    0 8px 20px rgba(0, 0, 0, 0.22) !important;
                color: #eadde1 !important;
                transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
            }

            body.saevyn-active .group.relative:is(:hover, :focus-within) > .w-full.text-start
                > [class~="bg-token-bg-primary"][class~="border-token-border-light"] {
                border-color: rgba(230, 188, 106, 0.48) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(151, 56, 93, 0.31), transparent 56%),
                    linear-gradient(145deg, rgba(62, 22, 39, 0.98), rgba(29, 11, 20, 0.99)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.045),
                    0 10px 24px rgba(0, 0, 0, 0.27) !important;
            }

            body.saevyn-active header.sticky {
                border-bottom: 1px solid rgba(204, 156, 84, 0.18) !important;
                background:
                    radial-gradient(circle at 78% 0%, rgba(105, 32, 65, 0.17), transparent 40%),
                    linear-gradient(180deg, rgba(23, 8, 16, 0.97), rgba(13, 6, 10, 0.91)) !important;
                box-shadow: 0 10px 22px -22px rgba(231, 190, 109, 0.50) !important;
            }

            body.saevyn-active main#main > div.bg-primary.min-h-screen
                > div:has(> nav.flex.justify-center > [role="tablist"]) {
                padding-bottom: 0.72rem !important;
                border-bottom: 1px solid rgba(204, 156, 84, 0.22) !important;
                background:
                    radial-gradient(circle at 50% -42%, rgba(121, 39, 75, 0.25), transparent 44%),
                    linear-gradient(180deg, rgba(28, 9, 19, 0.96), rgba(14, 6, 11, 0.90)) !important;
                box-shadow:
                    inset 0 -1px rgba(255, 231, 172, 0.025),
                    0 11px 23px -23px rgba(231, 190, 109, 0.56) !important;
            }

            body.saevyn-active main#main > div.bg-primary.min-h-screen
                > div:has(> nav.flex.justify-center > [role="tablist"])
                > nav.flex.justify-center {
                position: relative;
                z-index: 1;
            }

            body.saevyn-active #main ul:has(> li.group > button) {
                border-block: 1px solid rgba(204, 156, 84, 0.12) !important;
                background:
                    linear-gradient(90deg, transparent, rgba(51, 17, 33, 0.48) 8%, rgba(51, 17, 33, 0.48) 92%, transparent) !important;
            }

            body.saevyn-active #main ul:has(> li.group > button) > li > button:is(:hover, :focus-visible) {
                background: rgba(100, 35, 61, 0.30) !important;
                color: #f5e8eb !important;
            }

            body.saevyn-active .images-app .pointer-events-auto > .border-token-border-default {
                border-color: rgba(218, 171, 88, 0.40) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(132, 43, 80, 0.27), transparent 54%),
                    linear-gradient(180deg, rgba(50, 17, 32, 0.97), rgba(23, 9, 16, 0.99)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.035),
                    0 10px 25px rgba(0, 0, 0, 0.26) !important;
                color: #eee2e6 !important;
            }

            body.saevyn-active button.button-glimmer-cta {
                border: 1px solid rgba(255, 231, 172, 0.36) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 242, 201, 0.24), transparent 54%),
                    linear-gradient(180deg, var(--saevyn-accent-fill-hover), var(--saevyn-accent-fill)) !important;
                color: var(--saevyn-accent-ink) !important;
                box-shadow:
                    inset 0 1px 0 rgba(255, 247, 221, 0.28),
                    0 4px 14px rgba(75, 46, 17, 0.26) !important;
                backdrop-filter: none !important;
            }

            body.saevyn-active button.button-glimmer-cta:hover,
            body.saevyn-active button.button-glimmer-cta:focus-visible {
                border-color: rgba(255, 242, 201, 0.60) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 248, 226, 0.30), transparent 54%),
                    linear-gradient(180deg, #efd58c, var(--saevyn-accent-fill-hover)) !important;
                color: #140c04 !important;
            }

            /* Current modal surfaces are portaled directly under body. Their
               native pseudo-backdrop obscures the deliberately low-luminance
               divider artwork once its entry transition settles. The styled
               opaque dialog and shadow provide focus without repainting or
               blurring the surrounding Saevyn interface. */
            body.saevyn-active [data-testid^="modal-"] > .fixed.inset-0::before {
                background: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            /* New-project creation uses the native dialog element as its
               viewport-sized overlay and places the modal surface directly
               inside it. It has no role=dialog, so cover this portal family
               by structure instead of depending on an accessibility role. */
            body.saevyn-active dialog:has(> [data-testid^="modal-"]) {
                background: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            body.saevyn-active dialog:has(> [data-testid^="modal-"])::backdrop {
                background: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            body.saevyn-active dialog > [data-testid^="modal-"] {
                border: 1px solid rgba(213, 164, 82, 0.36) !important;
                background:
                    radial-gradient(circle at 9% 0%, rgba(118, 39, 75, 0.24), transparent 44%),
                    linear-gradient(145deg, rgba(31, 12, 22, 0.998), rgba(12, 7, 11, 0.999) 72%) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.035),
                    inset 0 0 42px rgba(73, 19, 47, 0.08),
                    0 28px 78px rgba(0, 0, 0, 0.68) !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [data-testid="modal-new-project-enhanced"]
                [data-testid="create-new-project-form"] aside[class~="bg-token-bg-tertiary"] {
                border: 1px solid rgba(210, 163, 84, 0.18) !important;
                background:
                    radial-gradient(circle at 8% 0%, rgba(128, 42, 79, 0.18), transparent 46%),
                    linear-gradient(145deg, rgba(55, 24, 38, 0.88), rgba(29, 15, 23, 0.94)) !important;
                color: rgba(237, 222, 228, 0.76) !important;
                box-shadow: inset 0 1px 0 rgba(255, 235, 190, 0.035) !important;
            }

            body.saevyn-active [data-testid="modal-new-project-enhanced"]
                :is([data-testid="project-modal-trigger"], [data-testid="project-memory-scope-trigger"]) {
                border: 1px solid transparent !important;
                background: rgba(53, 19, 34, 0.20) !important;
                color: #eadde2 !important;
            }

            body.saevyn-active [data-testid="modal-new-project-enhanced"]
                :is([data-testid="project-modal-trigger"], [data-testid="project-memory-scope-trigger"]):is(:hover, :focus-visible) {
                border-color: rgba(211, 162, 81, 0.28) !important;
                background: rgba(75, 27, 48, 0.54) !important;
                color: var(--saevyn-gold-light) !important;
            }

            body.saevyn-active [data-testid="create-new-project-form"]
                button[type="submit"].btn-primary:disabled {
                border: 1px solid rgba(186, 134, 72, 0.20) !important;
                background: rgba(61, 39, 48, 0.72) !important;
                color: rgba(230, 217, 221, 0.56) !important;
                box-shadow: none !important;
                opacity: 1 !important;
            }

            body.saevyn-active [data-testid="modal-new-project-enhanced"] button[aria-label="Close"] {
                border: 1px solid transparent !important;
                border-radius: 9px !important;
                background: transparent !important;
                color: rgba(235, 220, 226, 0.78) !important;
            }

            body.saevyn-active [data-testid="modal-new-project-enhanced"] button[aria-label="Close"]:is(:hover, :focus-visible) {
                border-color: rgba(211, 162, 81, 0.26) !important;
                background: rgba(79, 28, 50, 0.54) !important;
                color: var(--saevyn-gold-light) !important;
            }

            body.saevyn-active [data-testid^="modal-"] [role="dialog"].popover {
                border: 1px solid rgba(213, 164, 82, 0.36) !important;
                background:
                    radial-gradient(circle at 9% 0%, rgba(118, 39, 75, 0.24), transparent 44%),
                    linear-gradient(145deg, rgba(31, 12, 22, 0.998), rgba(12, 7, 11, 0.999) 72%) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.035),
                    inset 0 0 42px rgba(73, 19, 47, 0.08),
                    0 28px 78px rgba(0, 0, 0, 0.68) !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [data-testid^="modal-"] [role="dialog"].popover
                :is(header, [role="banner"]) {
                border-color: rgba(207, 160, 78, 0.16) !important;
                background: linear-gradient(180deg, rgba(63, 21, 40, 0.26), transparent) !important;
            }

            body.saevyn-active [data-testid^="modal-"] [role="dialog"].popover a {
                color: var(--saevyn-gold-light) !important;
                text-decoration-color: rgba(231, 190, 109, 0.48) !important;
            }

            body.saevyn-active [data-testid^="modal-"] [role="dialog"].popover .btn-secondary {
                border-color: rgba(207, 158, 82, 0.28) !important;
                background: rgba(51, 18, 33, 0.58) !important;
                color: #eee1e5 !important;
            }

            body.saevyn-active [data-testid^="modal-"] [role="dialog"].popover .btn-danger {
                border: 1px solid rgba(239, 141, 153, 0.42) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(255, 202, 184, 0.15), transparent 56%),
                    linear-gradient(180deg, #9a2945, #681a34) !important;
                box-shadow: inset 0 1px rgba(255, 232, 207, 0.13), 0 5px 14px rgba(62, 8, 26, 0.34) !important;
                color: #fff1ed !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"]) {
                border: 1px solid rgba(213, 164, 82, 0.38) !important;
                background:
                    radial-gradient(circle at 8% 0%, rgba(118, 39, 75, 0.24), transparent 42%),
                    linear-gradient(145deg, rgba(31, 12, 22, 0.998), rgba(12, 7, 11, 0.999) 72%) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.035),
                    inset 0 0 54px rgba(73, 19, 47, 0.09),
                    0 28px 78px rgba(0, 0, 0, 0.68) !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                div:has(> [role="tablist"][aria-label="Settings"]) {
                border-color: rgba(203, 153, 76, 0.22) !important;
                background:
                    radial-gradient(circle at 18% 5%, rgba(116, 38, 73, 0.21), transparent 48%),
                    linear-gradient(180deg, rgba(29, 10, 20, 0.995), rgba(15, 7, 12, 0.998)) !important;
                box-shadow: 12px 0 28px -28px rgba(239, 202, 129, 0.52);
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tablist"][aria-label="Settings"] {
                border: 0 !important;
                border-radius: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                scrollbar-color: rgba(188, 134, 72, 0.42) transparent;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tab"] {
                border: 1px solid transparent !important;
                border-radius: 10px !important;
                background: transparent !important;
                color: #cfc1c6 !important;
                transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tab"]:hover {
                border-color: rgba(184, 129, 84, 0.15) !important;
                background: rgba(96, 34, 61, 0.17) !important;
                color: #f0e5e8 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tab"][aria-selected="true"] {
                border-color: rgba(213, 137, 157, 0.38) !important;
                background:
                    radial-gradient(circle at 9% 50%, rgba(147, 68, 104, 0.28), transparent 52%),
                    linear-gradient(90deg, rgba(91, 31, 56, 0.58), rgba(68, 24, 44, 0.36)) !important;
                box-shadow:
                    inset 0 0 15px rgba(139, 56, 92, 0.11),
                    0 5px 14px rgba(0, 0, 0, 0.16);
                color: #f5e9ec !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                input[aria-label="Search settings"] {
                border-color: rgba(200, 151, 86, 0.26) !important;
                background: rgba(8, 5, 8, 0.60) !important;
                box-shadow: inset 0 0 14px rgba(87, 25, 56, 0.14);
                color: #eee3e7 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                input[aria-label="Search settings"]:focus {
                border-color: rgba(232, 195, 119, 0.56) !important;
                box-shadow:
                    inset 0 0 14px rgba(87, 25, 56, 0.14),
                    0 0 0 2px rgba(199, 155, 79, 0.12) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] {
                background:
                    radial-gradient(circle at 92% 3%, rgba(104, 31, 69, 0.16), transparent 38%),
                    linear-gradient(160deg, rgba(25, 11, 18, 0.985), rgba(12, 8, 11, 0.995)) !important;
                color: #eee3e7 !important;
                scrollbar-color: rgba(188, 134, 72, 0.42) transparent;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] [class*="border-token-border"] {
                border-color: rgba(201, 151, 81, 0.17) !important;
            }

            /* Settings owns a dark control contract even when ChatGPT's saved
               Appearance is Light. These selectors follow reusable native
               control families shared by every current Settings tab. */
            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"]) {
                color-scheme: dark !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] :is(button[role="combobox"], button[class~="bg-white"]) {
                border: 1px solid rgba(207, 158, 82, 0.23) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(119, 40, 74, 0.20), transparent 55%),
                    linear-gradient(180deg, rgba(43, 16, 28, 0.90), rgba(22, 10, 16, 0.96)) !important;
                box-shadow: inset 0 0 0 1px rgba(255, 231, 172, 0.022) !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] :is(button[role="combobox"], button[class~="bg-white"]):is(:hover, :focus-visible, [data-state="open"]) {
                border-color: rgba(232, 193, 116, 0.46) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(145, 55, 88, 0.28), transparent 57%),
                    linear-gradient(180deg, rgba(59, 21, 38, 0.94), rgba(29, 12, 21, 0.98)) !important;
                color: #fff0c5 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] .btn-secondary {
                border: 1px solid rgba(207, 158, 82, 0.24) !important;
                background: rgba(43, 17, 28, 0.78) !important;
                color: #eadde1 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] .btn-secondary:is(:hover, :focus-visible) {
                border-color: rgba(232, 193, 116, 0.46) !important;
                background: rgba(82, 29, 50, 0.72) !important;
                color: #fff0c5 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] [role="switch"] {
                border: 1px solid rgba(199, 155, 79, 0.25) !important;
                background: rgba(74, 52, 62, 0.88) !important;
                box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.24) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] [role="switch"][aria-checked="true"] {
                border-color: rgba(235, 199, 124, 0.48) !important;
                background: linear-gradient(90deg, #6f2946, #b08245) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] [role="switch"] > span {
                background: #f4e5be !important;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.42) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] :is(input:not([type="checkbox"]):not([type="radio"]), textarea, select) {
                border-color: var(--saevyn-line) !important;
                background: var(--saevyn-bg) !important;
                color: var(--saevyn-text) !important;
                caret-color: var(--saevyn-gold-light) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] input[type="checkbox"] {
                border-color: var(--saevyn-line-strong) !important;
                background-color: var(--saevyn-bg) !important;
                accent-color: var(--saevyn-accent-fill) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] input[type="checkbox"]:checked {
                background-color: var(--saevyn-accent-fill) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] :is(
                    [class~="bg-token-bg-primary"],
                    [class~="bg-token-bg-elevated-primary"],
                    [class~="bg-token-bg-secondary"]
                ):not(input):not(textarea) {
                border-color: rgba(202, 154, 82, 0.20) !important;
                background-color: #160b11 !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] button.interactive-button-primary {
                border: 1px solid rgba(232, 193, 116, 0.44) !important;
                background: linear-gradient(180deg, rgba(103, 38, 62, 0.96), rgba(55, 20, 37, 0.98)) !important;
                color: #fff0c5 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] [role="radio"][class~="h-2"] {
                border: 1px solid rgba(212, 167, 88, 0.34) !important;
                background: rgba(114, 76, 91, 0.58) !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                [role="tabpanel"] [role="radio"][class~="h-2"][aria-checked="true"] {
                border-color: #f1ce7f !important;
                background: #d4a552 !important;
                box-shadow: 0 0 0 2px rgba(212, 165, 82, 0.18) !important;
            }

            /* Radix select content is portaled to body rather than nested in
               Settings, so it needs its own structural listbox contract. */
            body.saevyn-active [role="listbox"].popover:has([role="option"]) {
                border: 1px solid rgba(213, 164, 82, 0.30) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(124, 43, 77, 0.24), transparent 52%),
                    linear-gradient(180deg, rgba(35, 13, 23, 0.998), rgba(15, 8, 12, 0.999)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.025),
                    0 18px 42px rgba(0, 0, 0, 0.54) !important;
                color: #eee3e7 !important;
            }

            body.saevyn-active [role="listbox"].popover:has([role="option"]) [role="option"] {
                border-radius: 10px !important;
                color: #ddd0d5 !important;
            }

            body.saevyn-active [role="listbox"].popover:has([role="option"])
                [role="option"]:is(:hover, :focus-visible, [data-highlighted]) {
                background: rgba(91, 31, 56, 0.62) !important;
                color: #fff0c5 !important;
            }

            body.saevyn-active [role="listbox"].popover:has([role="option"])
                [role="option"][aria-selected="true"] {
                color: #f3d891 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                button[aria-label="Close"] {
                border: 1px solid rgba(207, 158, 82, 0.24) !important;
                background: rgba(50, 17, 33, 0.38) !important;
                color: #eadde1 !important;
            }

            body.saevyn-active [role="dialog"]:has(input[aria-label="Search settings"])
                button[aria-label="Close"]:hover {
                border-color: rgba(234, 197, 123, 0.46) !important;
                background: rgba(90, 31, 57, 0.48) !important;
            }

            body.saevyn-active header:has([role="radiogroup"][aria-label="Select chat surface"]) {
                border-bottom: 1px solid rgba(207, 160, 78, 0.12) !important;
                background:
                    radial-gradient(circle at 50% -80%, rgba(115, 38, 77, 0.22), transparent 48%),
                    linear-gradient(180deg, rgba(24, 8, 16, 0.985), rgba(12, 7, 11, 0.94)) !important;
                box-shadow: 0 13px 24px -25px rgba(235, 190, 104, 0.62);
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"] {
                border: 0 !important;
                background: rgba(10, 6, 9, 0.70) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(206, 157, 79, 0.24),
                    inset 0 0 16px rgba(88, 25, 57, 0.12),
                    0 5px 16px rgba(0, 0, 0, 0.22) !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"] > div:first-child {
                background: rgba(55, 20, 38, 0.26) !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"]
                [data-tpp-toggle-highlight] {
                border: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                opacity: 1 !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"]
                [data-tpp-toggle-highlight] > div {
                border: 0 !important;
                border-radius: 999px !important;
                background:
                    radial-gradient(circle at 24% 42%, rgba(147, 66, 104, 0.27), transparent 56%),
                    linear-gradient(90deg, rgba(90, 31, 57, 0.62), rgba(54, 20, 37, 0.50)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(211, 139, 157, 0.30),
                    inset 0 0 13px rgba(148, 61, 101, 0.10),
                    0 2px 8px rgba(0, 0, 0, 0.18) !important;
                opacity: 1 !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"] [role="radio"] {
                border: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                color: #bbaeb3 !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"] [role="radio"]:hover {
                background: transparent !important;
                color: #f0e4e8 !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"] [role="radio"]:focus-visible {
                outline: 1px solid rgba(226, 185, 102, 0.72) !important;
                outline-offset: -3px !important;
            }

            body.saevyn-active [role="radiogroup"][aria-label="Select chat surface"] [role="radio"][data-state="on"] {
                border: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                color: #f6e6b9 !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) [class~="bg-surface-primary"] {
                background: transparent !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(aside) {
                position: relative !important;
                inset: auto !important;
                z-index: 0 !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(aside) aside {
                isolation: isolate;
                border-color: rgba(205, 156, 83, 0.24) !important;
                border-bottom-color: rgba(205, 156, 83, 0.08) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(115, 39, 73, 0.22), transparent 47%),
                    linear-gradient(180deg, rgba(30, 11, 21, 0.995), rgba(16, 7, 12, 0.998)) !important;
                box-shadow:
                    inset 0 1px rgba(255, 228, 167, 0.035),
                    0 -12px 30px rgba(0, 0, 0, 0.30) !important;
                color: #eadde1 !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(aside) aside button {
                border-color: rgba(203, 153, 81, 0.20) !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(aside) aside button:hover {
                border-color: rgba(226, 182, 101, 0.42) !important;
                background: rgba(91, 33, 58, 0.40) !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) {
                margin-top: 7px !important;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li + li {
                margin-top: 6px !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li > button:first-child {
                border: 1px solid rgba(202, 153, 82, 0.24) !important;
                border-radius: 13px !important;
                background:
                    radial-gradient(circle at 10% 0%, rgba(112, 37, 72, 0.20), transparent 46%),
                    linear-gradient(180deg, rgba(35, 13, 24, 0.96), rgba(17, 8, 13, 0.98)) !important;
                color: #d9cbd0 !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 229, 168, 0.022),
                    0 8px 20px rgba(0, 0, 0, 0.25) !important;
                transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li > button:first-child:hover,
            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li[data-selected] > button:first-child {
                border-color: rgba(226, 182, 101, 0.46) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(143, 51, 88, 0.28), transparent 48%),
                    linear-gradient(180deg, rgba(59, 21, 39, 0.97), rgba(29, 11, 20, 0.99)) !important;
                color: #f2e0b1 !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 229, 168, 0.035),
                    0 10px 24px rgba(0, 0, 0, 0.30) !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li > button:first-child *,
            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li[data-selected] > button:first-child * {
                color: inherit !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li > button:not(:first-child) {
                color: var(--saevyn-gold) !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:has(ul > li > button:first-child) ul:has(> li > button:first-child) > li > button:not(:first-child):is(:hover, :focus-visible) {
                background: rgba(91, 32, 57, 0.42) !important;
                color: var(--saevyn-gold-light) !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:last-child:has(button) {
                border: 1px solid rgba(201, 151, 81, 0.20) !important;
                border-top-color: rgba(201, 151, 81, 0.08) !important;
                background:
                    radial-gradient(circle at 10% 100%, rgba(104, 34, 68, 0.16), transparent 48%),
                    linear-gradient(180deg, rgba(27, 11, 19, 0.97), rgba(12, 7, 11, 0.99)) !important;
                box-shadow:
                    inset 0 -1px rgba(255, 228, 167, 0.025),
                    0 12px 26px rgba(0, 0, 0, 0.25) !important;
                color: #cfc1c6 !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:last-child:has(button) button {
                border: 1px solid transparent !important;
                border-radius: 10px !important;
                color: #cfc1c6 !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:last-child:has(button) button:hover {
                border-color: rgba(198, 132, 151, 0.20) !important;
                background: rgba(89, 31, 56, 0.28) !important;
                color: #f0e4e8 !important;
            }

            body.saevyn-active div:has(> form[data-type="unified-composer"])
                > div:last-child:has(button) div:has(> img) {
                border-color: rgba(201, 151, 81, 0.16) !important;
                background: rgba(30, 12, 21, 0.96) !important;
            }

            body.saevyn-active #stage-slideover-sidebar nav:has(#sidebar-header),
            body.saevyn-active #stage-popover-sidebar nav:has(#sidebar-header) {
                scrollbar-color: rgba(185, 132, 71, 0.38) transparent;
            }

            body.saevyn-active #stage-slideover-sidebar
                section:has(button[aria-label^="Open Work usage details"])
                > div > div:has(> button[aria-label^="Open Work usage details"]),
            body.saevyn-active #stage-popover-sidebar
                section:has(button[aria-label^="Open Work usage details"])
                > div > div:has(> button[aria-label^="Open Work usage details"]) {
                border-color: rgba(207, 158, 82, 0.24) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(112, 37, 70, 0.22), transparent 52%),
                    linear-gradient(180deg, rgba(29, 11, 20, 0.99), rgba(14, 7, 11, 0.995)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 229, 168, 0.025),
                    0 9px 20px rgba(0, 0, 0, 0.28) !important;
                color: #e3d6da !important;
            }

            body.saevyn-active #stage-sidebar-tiny-bar :is(a, button):hover,
            body.saevyn-active #stage-sidebar-tiny-bar :is(a, button):focus-visible {
                background: rgba(91, 32, 57, 0.42) !important;
                box-shadow: inset 0 0 0 1px rgba(205, 153, 87, 0.16) !important;
                color: #f1e5e9 !important;
            }

            body.saevyn-active :is(
                [role="tooltip"],
                [data-oai-tooltip-surface]
            ) {
                border: 1px solid rgba(225, 181, 96, 0.46) !important;
                border-radius: 11px !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(151, 54, 94, 0.36), transparent 62%),
                    linear-gradient(180deg, rgba(61, 19, 38, 0.998), rgba(24, 9, 17, 0.999)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.07),
                    0 0 0 2px rgba(199, 155, 79, 0.05),
                    0 12px 28px rgba(0, 0, 0, 0.46) !important;
                color: #fff0c7 !important;
            }

            body.saevyn-active :is(
                [role="tooltip"],
                [data-oai-tooltip-surface]
            ) * {
                color: inherit !important;
            }

            body.saevyn-active .wm-app-scrollToBottomButton {
                border: 1px solid rgba(225, 181, 96, 0.52) !important;
                background:
                    radial-gradient(circle at 28% 14%, rgba(151, 54, 94, 0.30), transparent 60%),
                    linear-gradient(180deg, rgba(65, 22, 40, 0.96), rgba(22, 9, 16, 0.98)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.06),
                    0 0 0 3px rgba(199, 155, 79, 0.055),
                    0 8px 22px rgba(0, 0, 0, 0.38) !important;
                color: #ffe5a6 !important;
            }

            body.saevyn-active .wm-app-scrollToBottomButton:is(:hover, :focus-visible) {
                border-color: rgba(244, 207, 125, 0.76) !important;
                background:
                    radial-gradient(circle at 28% 14%, rgba(177, 68, 111, 0.39), transparent 60%),
                    linear-gradient(180deg, rgba(84, 29, 50, 0.98), rgba(31, 11, 21, 0.99)) !important;
                color: #fff1c8 !important;
            }

            body.saevyn-active .wm-app-scrollToBottomButton :is(svg, span) {
                color: inherit !important;
            }

            body.saevyn-active .wm-desktop-detailHeader {
                border-bottom: 1px solid rgba(199, 155, 79, 0.16) !important;
                background:
                    radial-gradient(circle at 78% 0%, rgba(104, 32, 64, 0.16), transparent 38%),
                    linear-gradient(180deg, rgba(19, 7, 13, 0.94), rgba(10, 5, 8, 0.72)) !important;
            }

            body.saevyn-active .wm-desktop-detailHeader .wm-button--primary,
            body.saevyn-active .wm-sidebar-loginPanel .wm-sidebar-loginButton {
                border: 1px solid rgba(244, 207, 125, 0.68) !important;
                background: linear-gradient(180deg, #dfb85f, #b98536) !important;
                color: #241307 !important;
                box-shadow:
                    inset 0 1px rgba(255, 239, 190, 0.36),
                    0 5px 15px rgba(116, 68, 24, 0.20) !important;
            }

            body.saevyn-active .wm-desktop-detailHeader .wm-button--secondary {
                border: 1px solid rgba(215, 167, 91, 0.38) !important;
                background: rgba(65, 22, 40, 0.62) !important;
                color: #f6e5b7 !important;
            }

            body.saevyn-active .wm-sidebar-loginPanel {
                border: 1px solid rgba(199, 155, 79, 0.18) !important;
                border-radius: 14px !important;
                background:
                    radial-gradient(circle at 16% 0%, rgba(119, 39, 73, 0.24), transparent 58%),
                    linear-gradient(180deg, rgba(35, 12, 23, 0.96), rgba(17, 7, 12, 0.98)) !important;
                box-shadow: inset 0 0 0 1px rgba(255, 231, 172, 0.025) !important;
            }

            body.saevyn-active form.wm-composer-composer {
                border: 1px solid rgba(213, 164, 82, 0.54) !important;
                background:
                    radial-gradient(circle at 12% 0%, rgba(122, 40, 74, 0.22), transparent 52%),
                    linear-gradient(180deg, rgba(38, 13, 25, 0.97), rgba(18, 8, 13, 0.99)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.035),
                    0 8px 24px rgba(0, 0, 0, 0.26) !important;
            }

            body.saevyn-active form.wm-composer-composer :is(
                .wm-composer-actionButton,
                .wm-composer-dictationButton
            ):is(:hover, :focus-visible, [aria-expanded="true"]) {
                background: rgba(105, 39, 66, 0.50) !important;
                color: #ffe5a6 !important;
                box-shadow: inset 0 0 0 1px rgba(224, 181, 99, 0.25) !important;
            }

            body.saevyn-active .wm-app-emptyComposerAction {
                border: 1px solid rgba(213, 164, 82, 0.38) !important;
                background: rgba(64, 23, 40, 0.60) !important;
                color: #f6e5b7 !important;
                box-shadow: inset 0 0 0 1px rgba(255, 231, 172, 0.025) !important;
            }

            body.saevyn-active .wm-app-emptyComposerAction:is(:hover, :focus-visible) {
                border-color: rgba(239, 199, 116, 0.66) !important;
                background: rgba(97, 35, 59, 0.76) !important;
                color: #fff1c8 !important;
            }

            body.saevyn-active #page-header [data-testid="open-sidebar-button"] {
                border: 1px solid rgba(204, 156, 84, 0.18) !important;
                background:
                    radial-gradient(circle at 24% 10%, rgba(109, 37, 69, 0.20), transparent 58%),
                    linear-gradient(180deg, rgba(29, 11, 20, 0.78), rgba(13, 7, 11, 0.86)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.018),
                    0 5px 14px rgba(0, 0, 0, 0.24) !important;
                color: #ded1d5 !important;
            }

            body.saevyn-active #page-header [data-testid="open-sidebar-button"]:hover,
            body.saevyn-active #page-header [data-testid="open-sidebar-button"]:focus-visible {
                border-color: var(--saevyn-line-strong) !important;
                background:
                    radial-gradient(circle at 22% 18%, var(--saevyn-accent-wash-strong), transparent 58%),
                    linear-gradient(180deg, var(--saevyn-panel), var(--saevyn-bg)) !important;
                box-shadow:
                    inset 0 0 13px rgba(138, 56, 91, 0.10),
                    0 0 0 2px rgba(199, 155, 79, 0.06),
                    0 7px 17px rgba(0, 0, 0, 0.30) !important;
                color: var(--saevyn-text) !important;
            }

            body.saevyn-active #page-header [data-testid="open-sidebar-button"] svg {
                color: inherit !important;
            }

            body.saevyn-active #page-header .translucent-surface.rounded-lg:has(.text-token-text-primary) {
                border: 1px solid rgba(204, 156, 84, 0.28) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(120, 42, 76, 0.26), transparent 62%),
                    linear-gradient(180deg, rgba(38, 13, 25, 0.92), rgba(17, 8, 13, 0.96)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.026),
                    0 5px 16px rgba(0, 0, 0, 0.26) !important;
            }

            body.saevyn-active #page-header .translucent-surface.rounded-lg:has(.text-token-text-primary) .text-token-text-tertiary {
                color: rgba(230, 201, 139, 0.72) !important;
            }

            body.saevyn-active #page-header [data-testid="thread-header-right-actions-container"] + div aside {
                border: 1px solid rgba(213, 164, 82, 0.34) !important;
                background:
                    radial-gradient(circle at 82% 0%, rgba(128, 43, 78, 0.28), transparent 54%),
                    linear-gradient(180deg, rgba(39, 13, 25, 0.985), rgba(17, 7, 12, 0.992)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.032),
                    0 16px 34px rgba(0, 0, 0, 0.42) !important;
                color: var(--saevyn-text) !important;
            }

            body.saevyn-active #page-header [data-testid="thread-header-right-actions-container"] + div aside section + section {
                border-top: 1px solid rgba(204, 156, 84, 0.16) !important;
            }

            body.saevyn-active #page-header [data-testid="thread-header-right-actions-container"] + div aside :is(
                button,
                [role="region"],
                span
            ) {
                color: inherit !important;
            }

            body.saevyn-active #page-header [data-testid="thread-header-right-actions-container"] + div aside button:is(:hover, :focus-visible) {
                background: rgba(100, 35, 62, 0.48) !important;
                color: #ffe7aa !important;
                box-shadow: inset 0 0 0 1px rgba(224, 181, 99, 0.22) !important;
            }

            body.saevyn-active #page-header [data-testid="thread-header-right-actions-container"] + div aside
                [role="region"] li[class~="bg-token-bg-primary"].sticky {
                background: transparent !important;
            }

            body.saevyn-active [data-testid="rate-limit-attached-banner-ctas"] > button:first-child {
                border: 1px solid rgba(244, 207, 125, 0.72) !important;
                background: linear-gradient(180deg, #e1bd67, #b98536) !important;
                color: #241307 !important;
                box-shadow:
                    inset 0 1px rgba(255, 242, 200, 0.40),
                    0 5px 16px rgba(116, 68, 24, 0.24) !important;
            }

            body.saevyn-active [data-testid="rate-limit-attached-banner-ctas"] > button:first-child:is(:hover, :focus-visible) {
                border-color: rgba(255, 231, 164, 0.90) !important;
                background: linear-gradient(180deg, #efd080, #c99542) !important;
                color: #1d0e04 !important;
            }

            body.saevyn-active #conversation-header-actions {
                border: 1px solid rgba(204, 156, 84, 0.22) !important;
                background:
                    radial-gradient(circle at 18% 0%, rgba(113, 39, 72, 0.22), transparent 58%),
                    linear-gradient(180deg, rgba(31, 12, 22, 0.88), rgba(14, 7, 11, 0.94)) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 231, 172, 0.022),
                    0 5px 16px rgba(0, 0, 0, 0.28) !important;
            }

            body.saevyn-active #conversation-header-actions :is(
                [data-testid="share-chat-button"],
                [data-testid="conversation-options-button"]
            ) {
                border: 1px solid transparent !important;
                background: transparent !important;
                color: var(--saevyn-accent-text) !important;
                box-shadow: none !important;
            }

            body.saevyn-active #conversation-header-actions :is(
                [data-testid="share-chat-button"],
                [data-testid="conversation-options-button"]
            ):is(:hover, :focus-visible, [aria-expanded="true"]) {
                border-color: var(--saevyn-line-strong) !important;
                background:
                    radial-gradient(circle at 22% 18%, var(--saevyn-accent-wash-strong), transparent 58%),
                    var(--saevyn-panel) !important;
                color: var(--saevyn-gold-light) !important;
                box-shadow:
                    inset 0 0 12px rgba(199, 155, 79, 0.07),
                    0 3px 10px rgba(0, 0, 0, 0.20) !important;
            }

            body.saevyn-active #conversation-header-actions :is(
                [data-testid="share-chat-button"],
                [data-testid="conversation-options-button"]
            ) :is(svg, div) {
                color: inherit !important;
            }

            body.saevyn-active #stage-slideover-sidebar [data-sidebar-item="true"],
            body.saevyn-active #stage-popover-sidebar [data-sidebar-item="true"] {
                border: 1px solid transparent !important;
                border-radius: 11px !important;
                color: var(--saevyn-text) !important;
                transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
            }

            body.saevyn-active #stage-slideover-sidebar [data-sidebar-item="true"]:not(#sidebar-header [data-sidebar-item="true"]):hover,
            body.saevyn-active #stage-popover-sidebar [data-sidebar-item="true"]:not(#sidebar-header [data-sidebar-item="true"]):hover {
                border-color: var(--saevyn-line) !important;
                background: var(--saevyn-accent-wash) !important;
            }

            body.saevyn-active #stage-slideover-sidebar [data-sidebar-item="true"]:not(#sidebar-header [data-sidebar-item="true"])[data-active],
            body.saevyn-active #stage-popover-sidebar [data-sidebar-item="true"]:not(#sidebar-header [data-sidebar-item="true"])[data-active] {
                margin-inline-start: 0.42rem !important;
                width: calc(100% - 0.42rem) !important;
                border-color: var(--saevyn-line-strong) !important;
                background:
                    radial-gradient(circle at 8% 50%, var(--saevyn-accent-wash-strong), transparent 48%),
                    var(--saevyn-accent-wash) !important;
                box-shadow:
                    inset 0 0 18px rgba(134, 56, 92, 0.13),
                    0 0 16px rgba(121, 48, 77, 0.10) !important;
                color: var(--saevyn-text) !important;
            }

            body.saevyn-active #stage-slideover-sidebar h2,
            body.saevyn-active #stage-popover-sidebar h2 {
                color: #cdbfc4;
                font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
                font-weight: 500;
                letter-spacing: 0.025em;
            }

            body.saevyn-active form[data-type="unified-composer"] [data-composer-surface="true"] {
                position: relative !important;
                isolation: isolate;
                border: 1px solid transparent !important;
                border-radius: 25px !important;
                background:
                    radial-gradient(ellipse at 16% 0%, var(--saevyn-accent-wash), transparent 42%) padding-box,
                    linear-gradient(180deg, var(--saevyn-panel), var(--saevyn-bg)) padding-box,
                    linear-gradient(
                        112deg,
                        var(--saevyn-gold-shadow) 0%,
                        var(--saevyn-gold-deep) 11%,
                        var(--saevyn-gold-light) 27%,
                        var(--saevyn-gold) 43%,
                        var(--saevyn-gold-deep) 60%,
                        var(--saevyn-gold-light) 78%,
                        var(--saevyn-gold-shadow) 100%
                    ) border-box !important;
                box-shadow:
                    inset 0 -12px 22px rgba(78, 20, 75, 0.09),
                    0 1px 0 rgba(255, 231, 172, 0.06),
                    0 10px 32px rgba(0, 0, 0, 0.34) !important;
                transition: box-shadow 150ms ease, filter 150ms ease;
            }

            body.saevyn-active form[data-type="unified-composer"] [data-composer-surface="true"]::before {
                content: "";
                position: absolute;
                z-index: 0;
                inset: 3px;
                border: 1px solid var(--saevyn-line);
                border-radius: 21px;
                pointer-events: none;
            }

            body.saevyn-active form[data-type="unified-composer"] [data-composer-surface="true"] > * {
                position: relative;
                z-index: 1;
            }

            body.saevyn-active form[data-type="unified-composer"] [data-composer-surface="true"]:focus-within {
                filter: brightness(1.035);
                box-shadow:
                    inset 0 -12px 22px rgba(96, 28, 93, 0.12),
                    0 0 0 1px rgba(224, 185, 99, 0.16),
                    0 0 24px rgba(99, 40, 104, 0.12),
                    0 12px 35px rgba(0, 0, 0, 0.38) !important;
            }

            body.saevyn-active form[data-type="unified-composer"] .composer-submit-button-color:not(:disabled) {
                border: 1px solid rgba(255, 231, 172, 0.28) !important;
                background: var(--saevyn-accent-fill) !important;
                color: var(--saevyn-accent-ink) !important;
                box-shadow:
                    inset 0 1px 0 rgba(255, 244, 214, 0.24),
                    0 0 15px rgba(199, 155, 79, 0.16) !important;
            }

            body.saevyn-active form[data-type="unified-composer"] .composer-submit-button-color:not(:disabled):hover {
                background: var(--saevyn-accent-fill-hover) !important;
                color: #140c04 !important;
            }

            body.saevyn-active .user-message-bubble-color {
                border: 1px solid rgba(239, 213, 140, 0.34) !important;
                background:
                    radial-gradient(circle at 14% 0%, rgba(224, 181, 92, 0.18), transparent 54%),
                    linear-gradient(135deg, rgba(103, 69, 27, 0.92), rgba(44, 28, 13, 0.94)) !important;
                color: var(--theme-user-msg-text) !important;
                box-shadow:
                    inset 0 0 20px rgba(239, 213, 140, 0.06),
                    0 5px 18px rgba(0, 0, 0, 0.18);
            }

            body.saevyn-active section[data-turn="assistant"] :is(
                button[aria-label="Copy response"],
                button[aria-label="Add to project sources"],
                button[aria-label="Share"],
                button[aria-label="Switch model"],
                button[aria-label="More actions"],
                button[aria-label="Sources"],
                [role="group"] > button[aria-haspopup="dialog"]
            ) {
                border: 1px solid transparent !important;
                background: transparent !important;
                color: var(--saevyn-gold) !important;
                transition:
                    color 140ms ease,
                    border-color 140ms ease,
                    background-color 140ms ease,
                    box-shadow 140ms ease;
            }

            body.saevyn-active section[data-turn="assistant"] :is(
                button[aria-label="Copy response"],
                button[aria-label="Add to project sources"],
                button[aria-label="Share"],
                button[aria-label="Switch model"],
                button[aria-label="More actions"],
                button[aria-label="Sources"],
                [role="group"] > button[aria-haspopup="dialog"]
            ):is(:hover, :focus-visible, [data-state="open"], [aria-expanded="true"]) {
                border-color: var(--saevyn-line-strong) !important;
                background: var(--saevyn-accent-wash) !important;
                color: var(--saevyn-gold-light) !important;
                box-shadow:
                    inset 0 0 12px rgba(199, 155, 79, 0.07),
                    0 4px 14px rgba(0, 0, 0, 0.22) !important;
                outline: none !important;
            }

            body.saevyn-active section[data-turn="assistant"] button[aria-label="Sources"] :is(svg, div) {
                color: var(--saevyn-gold) !important;
            }

            body.saevyn-active section[data-turn="assistant"] button[aria-label="Sources"]:is(:hover, :focus-visible) :is(svg, div) {
                color: var(--saevyn-gold-light) !important;
            }

            body.saevyn-active section[data-turn="assistant"] {
                container: saevyn-turn / inline-size;
            }

            body.saevyn-active .saevyn-message-body,
            body.saevyn-active .saevyn-message-body--multi {
                min-width: 0;
                padding: 0 !important;
                border: 0 !important;
                border-radius: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            body.saevyn-active .saevyn-message-body .markdown {
                color: var(--saevyn-text);
                font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
                font-size: 1.02rem;
                line-height: 1.68;
            }

            body.saevyn-active .saevyn-message-body pre,
            body.saevyn-active .saevyn-message-body code,
            body.saevyn-active .saevyn-message-body kbd,
            body.saevyn-active .saevyn-message-body samp {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            }

            body.saevyn-active .saevyn-speaker-header {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: stretch;
                width: 100%;
                min-width: 0;
                margin: 1.45rem 0 0.72rem;
                color: #d9c9d0;
                user-select: none;
                -webkit-user-select: none;
            }

            body.saevyn-active .saevyn-portrait {
                position: relative;
                display: grid;
                width: 46px;
                height: 46px;
                place-items: center;
                align-self: center;
                margin: 0 0 0.42rem;
                overflow: hidden;
                border: 1px solid rgba(230, 192, 112, 0.74);
                border-radius: 50%;
                background: rgba(8, 5, 9, 0.96);
                box-shadow:
                    0 0 0 3px rgba(8, 5, 9, 0.88),
                    0 0 0 4px rgba(199, 155, 79, 0.34),
                    inset 0 0 0 1px rgba(255, 232, 174, 0.08),
                    0 9px 26px rgba(0, 0, 0, 0.38),
                    0 0 26px color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 42%, transparent);
                pointer-events: none;
            }

            body.saevyn-active .saevyn-portrait::after {
                content: "";
                position: absolute;
                inset: 3px;
                border: 1px solid rgba(246, 218, 154, 0.24);
                border-radius: inherit;
                pointer-events: none;
            }

            body.saevyn-active .saevyn-portrait-canvas {
                display: block;
                width: 100%;
                height: 100%;
                max-width: none;
            }

            body.saevyn-active .saevyn-portrait--sigil .saevyn-portrait-canvas {
                width: 138%;
                height: 138%;
            }

            body.saevyn-active .saevyn-speaker--moon { --saevyn-accent: #aa8bc8; }
            body.saevyn-active .saevyn-speaker--sun { --saevyn-accent: #d9b878; }
            body.saevyn-active .saevyn-speaker--blade { --saevyn-accent: #7eaaa2; }
            body.saevyn-active .saevyn-speaker--ember { --saevyn-accent: #79669f; }
            body.saevyn-active .saevyn-speaker--star { --saevyn-accent: #d8c8df; }

            /* Each header carries its speaker's identity accent so the portrait
               ring, emblem halo, and name pick up violet, gold, teal, amethyst,
               or rose instead of reading as five identical gold headers. */
            body.saevyn-active .saevyn-speaker-header[data-saevyn-speaker="moon"] { --saevyn-accent: #aa8bc8; }
            body.saevyn-active .saevyn-speaker-header[data-saevyn-speaker="sun"] { --saevyn-accent: #d9b878; }
            body.saevyn-active .saevyn-speaker-header[data-saevyn-speaker="blade"] { --saevyn-accent: #7eaaa2; }
            body.saevyn-active .saevyn-speaker-header[data-saevyn-speaker="ember"] { --saevyn-accent: #79669f; }
            body.saevyn-active .saevyn-speaker-header[data-saevyn-speaker="star"] { --saevyn-accent: #d8c8df; }

            body.saevyn-active .saevyn-speaker-mark::before {
                content: "";
                position: absolute;
                inset: 2px -28px;
                z-index: -1;
                border-radius: 50%;
                background: radial-gradient(ellipse at center, color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 30%, transparent), transparent 68%);
                pointer-events: none;
            }

            body.saevyn-active .saevyn-speaker-header .saevyn-speaker-name {
                color: color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 44%, var(--saevyn-text));
            }

            @media (min-width: 1100px) {
                body.saevyn-active .saevyn-portrait {
                    position: absolute;
                    top: 0;
                    left: -64px;
                    width: 50px;
                    height: 50px;
                    margin: 0;
                }
            }

            body.saevyn-active .saevyn-speaker-header[data-saevyn-segment-index="0"] {
                margin-top: 0.45rem;
            }

            body.saevyn-active .saevyn-divider-assembly {
                display: grid;
                grid-template-columns: 63px minmax(0, 1fr) 126px minmax(0, 1fr) 63px;
                align-items: center;
                width: 100%;
                height: 46px;
                overflow: hidden;
            }

            body.saevyn-active .saevyn-divider-endpoint,
            body.saevyn-active .saevyn-divider-rail,
            body.saevyn-active .saevyn-speaker-emblem {
                display: block;
                height: 46px;
                max-width: none;
                object-fit: fill;
                pointer-events: none;
            }

            body.saevyn-active .saevyn-divider-endpoint {
                width: 63px;
            }

            body.saevyn-active .saevyn-divider-endpoint--right {
                transform: scaleX(-1);
                transform-origin: center;
            }

            body.saevyn-active .saevyn-divider-rail {
                width: 100%;
                min-width: 0;
                margin-inline: 0;
            }

            body.saevyn-active .saevyn-speaker-mark {
                position: relative;
                display: block;
                width: 126px;
                height: 46px;
                margin-inline: 0;
                z-index: 1;
            }

            body.saevyn-active .saevyn-speaker-emblem {
                width: 126px;
            }

            body.saevyn-active .saevyn-speaker-name {
                display: block;
                margin-top: -0.22rem;
                overflow-wrap: anywhere;
                color: #d7c4cc;
                font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
                font-size: 0.67rem;
                font-weight: 600;
                letter-spacing: 0.18em;
                line-height: 1.25;
                text-align: center;
                text-transform: uppercase;
                text-shadow: 0 1px 13px rgba(121, 73, 96, 0.34);
            }

            body.saevyn-active .saevyn-segment-content {
                position: relative;
            }

            body.saevyn-active .saevyn-message-body pre,
            body.saevyn-active .saevyn-message-body table,
            body.saevyn-active .saevyn-message-body img,
            body.saevyn-active .saevyn-message-body video,
            body.saevyn-active .saevyn-message-body canvas {
                max-width: 100%;
            }

            body.saevyn-active .saevyn-message-body pre,
            body.saevyn-active .saevyn-message-body table {
                overflow-x: auto;
            }

            body.saevyn-active [data-message-author-role="user"] {
                min-width: 0;
            }

            /* ChatGPT reactions are native controls/content. Keep their
               placement and semantics intact; give both directions a shared
               Saevyn jewel surface instead of leaving a bare floating emoji. */
            body.saevyn-active [data-testid="user-message-reaction"],
            body.saevyn-active [data-testid="assistant-message-reaction"] {
                box-sizing: border-box;
                border: 1px solid color-mix(
                    in srgb,
                    var(--saevyn-accent, var(--saevyn-gold-light)) 42%,
                    var(--saevyn-border)
                );
                border-radius: 999px;
                background:
                    radial-gradient(circle at 34% 24%, rgba(255, 255, 255, 0.14), transparent 42%),
                    color-mix(in srgb, var(--saevyn-panel) 92%, transparent);
                box-shadow:
                    0 0 0 2px color-mix(in srgb, var(--saevyn-bg) 72%, transparent),
                    0 7px 20px rgba(0, 0, 0, 0.28),
                    inset 0 0 12px color-mix(
                        in srgb,
                        var(--saevyn-accent, var(--saevyn-gold-light)) 10%,
                        transparent
                    );
                line-height: 1;
            }

            body.saevyn-active [data-testid="assistant-message-reaction"] {
                border-color: color-mix(
                    in srgb,
                    var(--saevyn-gold-light) 38%,
                    var(--saevyn-border)
                );
            }

            @media (max-width: 720px) {
                body.saevyn-active::before {
                    filter: none;
                    transform: none;
                }

                body.saevyn-active .saevyn-message-body .markdown {
                    font-size: 0.98rem;
                    line-height: 1.62;
                }

                body.saevyn-active .saevyn-speaker-header {
                    margin-top: 1.2rem;
                }

                body.saevyn-active .saevyn-portrait {
                    width: 42px;
                    height: 42px;
                    margin-bottom: 0.34rem;
                }

                body.saevyn-active .saevyn-speaker-header[data-saevyn-segment-index="0"] {
                    margin-top: 0.3rem;
                }

                body.saevyn-active .saevyn-divider-assembly {
                    grid-template-columns: 54px minmax(0, 1fr) 107px minmax(0, 1fr) 54px;
                    height: 39px;
                }

                body.saevyn-active .saevyn-divider-endpoint,
                body.saevyn-active .saevyn-divider-rail,
                body.saevyn-active .saevyn-speaker-emblem {
                    height: 39px;
                }

                body.saevyn-active .saevyn-divider-endpoint {
                    width: 54px;
                }

                body.saevyn-active .saevyn-speaker-mark,
                body.saevyn-active .saevyn-speaker-emblem {
                    width: 107px;
                }

                body.saevyn-active .saevyn-speaker-mark {
                    height: 39px;
                }

                body.saevyn-active .saevyn-speaker-name {
                    margin-top: -0.16rem;
                    font-size: 0.62rem;
                    letter-spacing: 0.15em;
                }

                body.saevyn-active form[data-type="unified-composer"] [data-composer-surface="true"] {
                    border-radius: 22px !important;
                    box-shadow:
                        inset 0 -8px 16px rgba(78, 20, 75, 0.08),
                        0 7px 22px rgba(0, 0, 0, 0.30) !important;
                }

                body.saevyn-active form[data-type="unified-composer"] [data-composer-surface="true"]::before {
                    border-radius: 18px;
                }

                body.saevyn-active div:has(> form[data-type="unified-composer"])
                    > div:has(aside) aside {
                    align-items: stretch !important;
                    flex-direction: column !important;
                    gap: 0.65rem !important;
                }

                body.saevyn-active div:has(> form[data-type="unified-composer"])
                    > div:has(aside) aside > :last-child {
                    align-self: flex-end;
                }
            }

            @container saevyn-turn (max-width: 720px) {
                body.saevyn-active .saevyn-message-body .markdown {
                    font-size: 0.98rem;
                    line-height: 1.62;
                }

                body.saevyn-active .saevyn-speaker-header { margin-top: 1.2rem; }
                body.saevyn-active .saevyn-divider-assembly {
                    grid-template-columns: 44px minmax(0, 1fr) 88px minmax(0, 1fr) 44px;
                    height: 36px;
                }
                body.saevyn-active .saevyn-divider-endpoint,
                body.saevyn-active .saevyn-divider-rail,
                body.saevyn-active .saevyn-speaker-emblem { height: 36px; }
                body.saevyn-active .saevyn-divider-endpoint { width: 44px; }
                body.saevyn-active .saevyn-speaker-mark,
                body.saevyn-active .saevyn-speaker-emblem { width: 88px; }
                body.saevyn-active .saevyn-speaker-mark { height: 36px; }
            }

            @media (prefers-reduced-motion: reduce) {
                body.saevyn-active *,
                body.saevyn-active *::before,
                body.saevyn-active *::after {
                    scroll-behavior: auto !important;
                    transition-duration: 0.01ms !important;
                    animation-duration: 0.01ms !important;
                    animation-iteration-count: 1 !important;
                }
            }
        `;
        const speakerAccentRules = Object.entries(SAEVYN_CONFIG.speakers)
            .map(([speakerId, speaker]) => {
                const safeId = String(speakerId).replace(/[^a-z0-9_-]/gi, "");
                const candidate = String(speaker.accent ?? "").trim();
                const accent = /^#[0-9a-f]{3,8}$/i.test(candidate) ? candidate : "#c79b4f";
                return safeId
                    ? `body.saevyn-active .saevyn-speaker--${safeId}, body.saevyn-active .saevyn-speaker-header[data-saevyn-speaker="${safeId}"] { --saevyn-accent: ${accent}; }`
                    : "";
            })
            .filter(Boolean)
            .join("\n");
        style.textContent = semanticizeLegacyThemeCss(rawThemeCss + "\n" + speakerAccentRules);

        const reverie = document.createElement("style");
        reverie.id = "saevyn-reverie-styles";
        reverie.dataset.saevynGenerated = "styles";
        reverie.textContent = REVERIE_CSS + "\n/* Community speaker ornament: one emoji portrait anchor, one horizontal\n   hairline, and a faint vertical thread beside the message body. */\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header {\n    position: relative !important;\n    display: grid !important;\n    grid-template-columns: 46px minmax(0, 1fr) !important;\n    grid-template-rows: 46px auto !important;\n    grid-template-areas:\n        \"portrait line\"\n        \"name line\" !important;\n    align-items: center !important;\n    column-gap: 16px !important;\n    row-gap: 0.24rem !important;\n    width: 100% !important;\n    min-width: 0 !important;\n    margin: 1.35rem 0 0.72rem !important;\n    color: var(--saevyn-accent, var(--saevyn-gold)) !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header::before,\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header::after,\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header > :is(.saevyn-laurel, .saevyn-rose, .saevyn-halo, .saevyn-ripple),\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header :is(.saevyn-divider-assembly, .saevyn-divider-endpoint, .saevyn-divider-rail, .saevyn-speaker-mark, .saevyn-speaker-emblem) {\n    display: none !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-community-portrait {\n    position: relative !important;\n    inset: auto !important;\n    grid-area: portrait !important;\n    display: grid !important;\n    place-items: center !important;\n    align-self: center !important;\n    justify-self: center !important;\n    width: 46px !important;\n    height: 46px !important;\n    margin: 0 !important;\n    overflow: visible !important;\n    border: 1px solid color-mix(in srgb, currentColor 48%, transparent) !important;\n    border-radius: 999px !important;\n    background: color-mix(in srgb, var(--saevyn-panel) 86%, var(--saevyn-bg)) !important;\n    box-shadow: inset 0 0 14px color-mix(in srgb, currentColor 11%, transparent), 0 0 16px color-mix(in srgb, currentColor 15%, transparent) !important;\n    color: inherit !important;\n    font-family: \"Segoe UI Emoji\", \"Apple Color Emoji\", sans-serif !important;\n    font-size: 1.18rem !important;\n    line-height: 1 !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-ornament {\n    grid-area: line !important;\n    display: block !important;\n    align-self: center !important;\n    width: 100% !important;\n    min-width: 0 !important;\n    height: 1px !important;\n    background: linear-gradient(90deg,\n        color-mix(in srgb, currentColor 55%, transparent),\n        color-mix(in srgb, currentColor 18%, transparent) 62%,\n        transparent) !important;\n    box-shadow: 0 0 9px color-mix(in srgb, currentColor 20%, transparent) !important;\n    opacity: 0.76 !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-ornament::before,\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-ornament::after {\n    content: none !important;\n    display: none !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-sigil {\n    display: none !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-name {\n    grid-area: name !important;\n    display: block !important;\n    width: 46px !important;\n    margin: 0 !important;\n    color: color-mix(in srgb, currentColor 48%, var(--saevyn-text)) !important;\n    font-family: var(--saevyn-message-font, var(--reverie-display-font)) !important;\n    font-size: 0.58rem !important;\n    font-weight: 600 !important;\n    letter-spacing: 0.14em !important;\n    line-height: 1.25 !important;\n    text-align: center !important;\n    text-transform: uppercase !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-name::before,\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-name::after {\n    content: none !important;\n    display: none !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header + .saevyn-segment-content {\n    position: relative !important;\n    margin-inline-start: 62px !important;\n}\nhtml[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header + .saevyn-segment-content::before {\n    content: \"\" !important;\n    position: absolute !important;\n    display: block !important;\n    top: -0.95rem !important;\n    bottom: -0.55rem !important;\n    left: -40px !important;\n    width: 1px !important;\n    background: linear-gradient(180deg,\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 50%, transparent),\n        color-mix(in srgb, var(--saevyn-accent, var(--saevyn-gold)) 16%, transparent)) !important;\n    pointer-events: none !important;\n}\n@media (max-width: 720px) {\n    html[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header {\n        grid-template-columns: 40px minmax(0, 1fr) !important;\n        grid-template-rows: 40px auto !important;\n        column-gap: 12px !important;\n    }\n    html[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-community-portrait {\n        width: 40px !important;\n        height: 40px !important;\n    }\n    html[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header .saevyn-speaker-name {\n        width: 40px !important;\n        font-size: 0.54rem !important;\n    }\n    html[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header + .saevyn-segment-content {\n        margin-inline-start: 52px !important;\n    }\n    html[data-saevyn-look] body.saevyn-active .saevyn-community-speaker-header + .saevyn-segment-content::before {\n        left: -32px !important;\n    }\n}\n";

        (document.head || document.documentElement).append(style, reverie);
        mountReverieSky();
    }

    function extractMeaningfulText(root) {
        if (!root) return "";

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;

        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (hasExcludedTextAncestor(parent, root)) {
                continue;
            }

            const text = node.nodeValue?.trimStart();
            if (text) return text;
        }

        return "";
    }

    function buildSpeakerPlan(turn) {
        const messageElements = turn.matches?.(MESSAGE_SELECTOR)
            ? [turn]
            : Array.from(turn.querySelectorAll(MESSAGE_SELECTOR));

        for (const messageElement of messageElements) {
            const markdownRoots = Array.from(messageElement.querySelectorAll(".markdown"));
            const contentRoots = markdownRoots.length ? markdownRoots : [messageElement];

            for (const contentRoot of contentRoots) {
                const blocks = contentRoot === messageElement
                    ? [contentRoot]
                    : Array.from(contentRoot.children)
                        .filter(child => !child.hasAttribute("data-saevyn-generated"));
                const usableBlocks = blocks.length ? blocks : [contentRoot];
                const blockTexts = usableBlocks.map(extractMeaningfulText);
                const firstMeaningfulText = blockTexts.find(Boolean);
                const firstSpeakerId = detectSpeakerId(firstMeaningfulText);
                if (!firstSpeakerId) continue;

                const runs = buildSpeakerRuns(blockTexts);
                if (!runs.length) continue;

                const sections = runs.map(run => ({
                    speakerId: run.speakerId,
                    startBlock: usableBlocks[run.startIndex],
                    blocks: usableBlocks.slice(run.startIndex, run.endIndex + 1)
                }));

                return {
                    speakerId: firstSpeakerId,
                    messageElement,
                    contentRoot,
                    sections
                };
            }
        }

        return null;
    }


    // Community leaves ChatGPT's favicon untouched and creates no image canvases.
    function syncFavicon() {}
    function restoreFavicon() {}
    function mutationsTouchFavicon() { return false; }

    function updateSidebarCurrentStyle() {
        const styleId = "saevyn-sidebar-current-style";
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement("style");
            style.id = styleId;
            style.dataset.saevynGenerated = "sidebar-current";
            document.head.append(style);
        }

        const escapeAttributeValue = value => String(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
        const pathname = location.pathname || "/";
        const selectors = [
            '[href="' + escapeAttributeValue(pathname) + '"]',
            pathname === "/" ? null : '[href^="' + escapeAttributeValue(pathname) + '?"]'
        ];
        const projectRoot = pathname.match(/^(\/g\/[^\/]+)/)?.[1];
        if (projectRoot && projectRoot !== pathname) {
            selectors.push('[href="' + escapeAttributeValue(projectRoot) + '"]');
        }
        const linkSelector = selectors.filter(Boolean).map(selector =>
            'body.saevyn-active :is(#stage-slideover-sidebar, #stage-popover-sidebar) a[data-sidebar-item="true"]:not(#sidebar-header a)' + selector
        ).join(",\n");

        style.textContent = linkSelector ? linkSelector + " {\n" +
            "  margin-inline-start: 0 !important;\n" +
            "  width: 100% !important;\n" +
            "  border: 1px solid color-mix(in srgb, var(--saevyn-gold) 34%, transparent) !important;\n" +
            "  border-radius: 12px !important;\n" +
            "  background: linear-gradient(90deg, color-mix(in srgb, var(--saevyn-gold) 16%, transparent), color-mix(in srgb, var(--saevyn-aurora) 7%, transparent)) !important;\n" +
            "  box-shadow: inset 2px 0 0 0 var(--saevyn-gold), 0 0 22px color-mix(in srgb, var(--saevyn-glow) 30%, transparent) !important;\n" +
            "  color: var(--saevyn-text) !important;\n" +
            "  position: relative !important;\n" +
            "}\n" +
            linkSelector.split(",\n").map(selector => "html:not([data-saevyn-density=\"quiet\"]) " + selector + "::after").join(",\n") + " {\n" +
            "  content: \"\";\n" +
            "  position: absolute;\n" +
            "  top: -1px;\n" +
            "  right: 12px;\n" +
            "  width: 9px;\n" +
            "  height: 22px;\n" +
            "  background: linear-gradient(180deg, var(--saevyn-gold-light), var(--saevyn-gold));\n" +
            "  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%);\n" +
            "  filter: drop-shadow(0 2px 4px color-mix(in srgb, var(--saevyn-bg) 70%, transparent));\n" +
            "  pointer-events: none;\n" +
            "}" : "";
    }

    function createHeader(speakerId) {
        const speaker = SAEVYN_CONFIG.speakers[speakerId];
        const speakerName = effectiveSpeakerName(speakerId, speaker);
        const header = document.createElement("div");
        const portrait = document.createElement("span");
        const ornament = document.createElement("span");
        const sigil = document.createElement("span");
        const name = document.createElement("span");

        header.className = "saevyn-speaker-header saevyn-community-speaker-header";
        header.dataset.saevynGenerated = "header";
        header.dataset.saevynHeader = "run";
        header.dataset.saevynSpeaker = speakerId;
        header.setAttribute("role", "heading");
        header.setAttribute("aria-level", "5");
        header.setAttribute("aria-label", speakerName + " speaker");

        portrait.className = "saevyn-portrait saevyn-community-portrait";
        portrait.dataset.saevynPortrait = "sigil";
        portrait.setAttribute("aria-label", speakerName + " sigil");
        portrait.textContent = effectiveSpeakerSigil(speakerId, speaker);

        ornament.className = "saevyn-speaker-ornament";
        ornament.setAttribute("aria-hidden", "true");
        sigil.className = "saevyn-speaker-sigil";
        sigil.textContent = effectiveSpeakerSigil(speakerId, speaker);
        header.dataset.saevynSigil = sigil.textContent;
        ornament.append(sigil);

        name.className = "saevyn-speaker-name";
        name.dataset.saevynSpeakerLabel = speakerName;
        name.textContent = speakerName;
        header.append(portrait, ornament, name);
        return header;
    }

    function syncRenderedSpeakerNames() {
        for (const header of document.querySelectorAll('[data-saevyn-header="run"][data-saevyn-speaker]')) {
            const speakerId = header.dataset.saevynSpeaker;
            const speaker = SAEVYN_CONFIG.speakers[speakerId];
            if (!speaker) continue;
            const speakerName = effectiveSpeakerName(speakerId, speaker);
            const sigil = effectiveSpeakerSigil(speakerId, speaker);
            const name = header.querySelector(".saevyn-speaker-name");
            const portrait = header.querySelector(".saevyn-community-portrait");
            const centerSigil = header.querySelector(".saevyn-speaker-sigil");
            if (name) {
                name.dataset.saevynSpeakerLabel = speakerName;
                name.textContent = speakerName;
            }
            if (portrait) {
                portrait.textContent = sigil;
                portrait.setAttribute("aria-label", speakerName + " sigil");
            }
            if (centerSigil) centerSigil.textContent = sigil;
            header.dataset.saevynSigil = sigil;
            header.setAttribute("aria-label", speakerName + " speaker");
        }
    }

    function clearSegmentArtifacts(turn) {
        for (const header of turn.querySelectorAll('[data-saevyn-header="run"]')) {
            header.remove();
        }

        for (const block of turn.querySelectorAll(".saevyn-segment-content")) {
            const speakerId = block.dataset.saevynSegmentSpeaker;
            block.classList.remove("saevyn-segment-content");
            if (speakerId) block.classList.remove(`saevyn-speaker--${speakerId}`);
            delete block.dataset.saevynSegmentSpeaker;
        }

        for (const message of turn.querySelectorAll(".saevyn-message-body--multi")) {
            message.classList.remove("saevyn-message-body--multi");
        }
    }

    function clearClassification(turn) {
        const currentSpeaker = turn.dataset.saevynSpeaker;
        const knownSpeakerClasses = Object.keys(SAEVYN_CONFIG.speakers)
            .map(speakerId => `saevyn-speaker--${speakerId}`);

        turn.classList.remove("saevyn-turn", ...knownSpeakerClasses);
        delete turn.dataset.saevynSpeaker;
        delete turn.dataset.saevynSequence;

        clearSegmentArtifacts(turn);

        for (const message of turn.querySelectorAll(".saevyn-message-body")) {
            message.classList.remove("saevyn-message-body");
            delete message.dataset.saevynSpeaker;
        }

        for (const header of turn.querySelectorAll(GENERATED_HEADER_SELECTOR)) {
            header.remove();
        }

        if (currentSpeaker) {
            debug("speaker cleared", turn.dataset.turnId || turn.dataset.testid || "unknown turn");
        }
    }

    function reconcileSegments(turn, plan) {
        const { messageElement, sections } = plan;
        const desiredHeaders = new Set();
        const knownSpeakerClasses = Object.keys(SAEVYN_CONFIG.speakers)
            .map(speakerId => `saevyn-speaker--${speakerId}`);

        for (const block of messageElement.querySelectorAll(".saevyn-segment-content")) {
            block.classList.remove("saevyn-segment-content", ...knownSpeakerClasses);
            delete block.dataset.saevynSegmentSpeaker;
        }

        messageElement.classList.toggle("saevyn-message-body--multi", sections.length > 1);

        sections.forEach((section, index) => {
            for (const block of section.blocks) {
                block.classList.add("saevyn-segment-content", `saevyn-speaker--${section.speakerId}`);
                block.dataset.saevynSegmentSpeaker = section.speakerId;
            }

            let header = section.startBlock.previousElementSibling;
            const reusable = header?.matches?.(
                `[data-saevyn-generated="header"][data-saevyn-header="run"][data-saevyn-speaker="${section.speakerId}"]`
            );

            if (!reusable) {
                if (header?.matches?.('[data-saevyn-header="run"]')) header.remove();
                header = createHeader(section.speakerId);
                section.startBlock.before(header);
            }

            header.classList.add("saevyn-speaker-header--run", `saevyn-speaker--${section.speakerId}`);
            header.dataset.saevynSegmentIndex = String(index);
            desiredHeaders.add(header);
        });

        for (const header of messageElement.querySelectorAll('[data-saevyn-header="run"]')) {
            if (!desiredHeaders.has(header)) header.remove();
        }
    }

    function applyClassification(turn, plan) {
        const { speakerId, messageElement, sections } = plan;
        const previousSpeaker = turn.dataset.saevynSpeaker;

        if (previousSpeaker && previousSpeaker !== speakerId) {
            turn.classList.remove(`saevyn-speaker--${previousSpeaker}`);
        }

        turn.classList.add("saevyn-turn", `saevyn-speaker--${speakerId}`);
        turn.dataset.saevynSpeaker = speakerId;
        const sequence = sections.map(section => section.speakerId).join(">");
        const previousSequence = turn.dataset.saevynSequence;
        turn.dataset.saevynSequence = sequence;

        for (const message of turn.querySelectorAll(".saevyn-message-body")) {
            if (message !== messageElement) {
                message.classList.remove("saevyn-message-body");
                delete message.dataset.saevynSpeaker;
            }
        }

        messageElement.classList.add("saevyn-message-body");
        messageElement.dataset.saevynSpeaker = speakerId;

        // Remove v0.1/v0.2 legacy outer headers if this script is reapplied in
        // an already-open page. Speaker-run headers are now the only UI path.
        for (const legacyHeader of turn.querySelectorAll(
            `${GENERATED_HEADER_SELECTOR}:not([data-saevyn-header="run"])`
        )) {
            legacyHeader.remove();
        }

        reconcileSegments(turn, plan);

        if (previousSpeaker !== speakerId || previousSequence !== sequence) {
            debug("speaker sequence detected", sequence, turn.dataset.turnId || turn.dataset.testid || "unknown turn");
        }
    }

    function processTurn(turn, allowClear = false) {
        if (paused || !(turn instanceof Element) || !turn.isConnected) return;
        if (!communitySettings?.speakerSeparation) {
            clearClassification(turn);
            return;
        }

        const plan = buildSpeakerPlan(turn);
        if (plan) {
            const timer = clearTimers.get(turn);
            if (timer) {
                clearTimeout(timer);
                clearTimers.delete(turn);
            }
            applyClassification(turn, plan);
            return;
        }

        if (!turn.dataset.saevynSpeaker) return;

        if (allowClear) {
            clearClassification(turn);
            clearTimers.delete(turn);
            return;
        }

        if (!clearTimers.has(turn)) {
            const timer = setTimeout(() => processTurn(turn, true), 260);
            clearTimers.set(turn, timer);
        }
    }

    function scheduleTurnRetry(turn, error) {
        const attempts = retryAttempts.get(turn) ?? 0;
        if (attempts >= 1) {
            retryAttempts.delete(turn);
            console.warn(
                `[Saevyn ${SAEVYN_VERSION}] Could not reconcile one assistant turn after a retry.`,
                error
            );
            return;
        }

        retryAttempts.set(turn, attempts + 1);
        debug("turn reconciliation collided; retrying once", error);

        const timer = setTimeout(() => {
            retryTimers.delete(turn);
            queueTurn(turn, true);
        }, TURN_RETRY_MS);
        retryTimers.set(turn, timer);
    }

    function processPendingTurn(turn) {
        try {
            processTurn(turn);
            retryAttempts.delete(turn);
            const retryTimer = retryTimers.get(turn);
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimers.delete(turn);
            }
        } catch (error) {
            scheduleTurnRetry(turn, error);
        }
    }

    function queueTurn(turn, immediate = true) {
        if (paused || !(turn instanceof Element)) return;

        if (!immediate) {
            const existingTimer = settleTimers.get(turn);
            if (existingTimer) clearTimeout(existingTimer);

            // This delay is also a correctness budget: it controls how long a
            // non-sigil character mutation may wait before visual reclassification.
            // Leading sigil mutations bypass it below and are always immediate.
            const timer = setTimeout(() => {
                settleTimers.delete(turn);
                queueTurn(turn, true);
            }, CHARACTER_SETTLE_MS);
            settleTimers.set(turn, timer);
            return;
        }

        const settleTimer = settleTimers.get(turn);
        if (settleTimer) {
            clearTimeout(settleTimer);
            settleTimers.delete(turn);
        }

        pendingTurns.add(turn);

        if (frameRequest) return;
        frameRequest = requestAnimationFrame(() => {
            frameRequest = 0;
            const batch = Array.from(pendingTurns);
            pendingTurns.clear();
            for (const pendingTurn of batch) processPendingTurn(pendingTurn);
        });
    }

    function mutationDeclaresSpeaker(node) {
        const parent = node?.parentElement;
        if (!parent) return false;
        const boundary = parent.closest(TURN_SELECTOR) || parent.closest(MESSAGE_SELECTOR);
        if (hasExcludedTextAncestor(parent, boundary)) {
            return false;
        }

        const previousSpeaker = leadingSpeakerByTextNode.get(node) ?? null;
        const nextSpeaker = detectSpeakerId(node.nodeValue);
        leadingSpeakerByTextNode.set(node, nextSpeaker);
        return Boolean(nextSpeaker && nextSpeaker !== previousSpeaker);
    }

    function queueTurnFromNode(node, immediate = true) {
        const element = node instanceof Element ? node : node?.parentElement;
        if (!element) return;

        if (element.matches(TURN_SELECTOR)) queueTurn(element, immediate);
        const closestTurn = element.closest(TURN_SELECTOR);
        if (closestTurn) queueTurn(closestTurn, immediate);

        if (node instanceof Element) {
            for (const nestedTurn of node.querySelectorAll(TURN_SELECTOR)) {
                queueTurn(nestedTurn, immediate);
            }
        }
    }

    function mutationIsSaevynGenerated(record) {
        if (record.type !== "childList") return false;
        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        if (!changedNodes.length) return false;
        return changedNodes.every(node => {
            const element = node instanceof Element ? node : node.parentElement;
            return Boolean(element?.matches("[data-saevyn-generated]") || element?.closest("[data-saevyn-generated]"));
        });
    }

    function sanitizeClipboardClone(root) {
        root.querySelectorAll([
            GENERATED_HEADER_SELECTOR,
            "canvas",
            ".saevyn-speaker-name",
            ".saevyn-divider-assembly",
            ".saevyn-portrait",
            ".saevyn-speaker-copy",
            "button",
            "[role='button']"
        ].join(",")).forEach(element => element.remove());

        // cloneContents() can omit the wrapper class when a selection begins
        // or ends inside a generated speaker label. Remove only standalone
        // text nodes that exactly equal a configured speaker's display name.
        const speakerNames = new Set(
            Object.entries(SAEVYN_CONFIG.speakers).flatMap(([speakerId, speaker]) => [
                speaker.name.trim().toLowerCase(),
                effectiveSpeakerName(speakerId, speaker).trim().toLowerCase()
            ])
        );
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const leakedLabels = [];
        while (walker.nextNode()) {
            if (speakerNames.has(walker.currentNode.nodeValue.trim().toLowerCase())) {
                leakedLabels.push(walker.currentNode);
            }
        }
        leakedLabels.forEach(node => node.remove());
        return root;
    }

    function installClipboardGuard() {
        // Sanitize an ordinary drag-selection Ctrl/Cmd+C when it crosses one
        // or more dividers. Preserve both plain text and rich HTML while
        // removing only elements generated by Saevyn. ChatGPT's own Copy
        // response button remains entirely native.
        document.addEventListener("copy", event => {
            const selection = document.getSelection();
            if (!selection?.rangeCount || selection.isCollapsed || !event.clipboardData) return;

            const range = selection.getRangeAt(0);
            const crossesHeader = [...document.querySelectorAll(GENERATED_HEADER_SELECTOR)]
                .some(header => range.intersectsNode(header));
            if (!crossesHeader) return;

            const fragment = range.cloneContents();
            const wrapper = document.createElement("div");
            wrapper.append(fragment);
            sanitizeClipboardClone(wrapper);
            event.preventDefault();
            event.clipboardData.setData("text/plain", wrapper.innerText || wrapper.textContent || "");
            event.clipboardData.setData("text/html", wrapper.innerHTML);
        }, true);
    }

    function reconcile() {
        reconcileRequest = 0;
        if (paused) return;
        for (const turn of document.querySelectorAll(TURN_SELECTOR)) {
            queueTurn(turn);
        }
    }

    function queueReconcile() {
        if (paused || reconcileRequest) return;
        reconcileRequest = requestAnimationFrame(reconcile);
    }

    function warnIfSelectorsBroken() {
        selectorCheckTimer = 0;
        if (!document.querySelector(MESSAGE_SELECTOR) || document.querySelector(TURN_SELECTOR)) return;
        if (selectorWarningUrl === location.href) return;

        selectorWarningUrl = location.href;
        console.warn(
            `[Saevyn ${SAEVYN_VERSION}] Assistant messages exist, but TURN_SELECTOR matched nothing. ` +
            "ChatGPT's DOM likely changed; update TURN_SELECTOR."
        );
    }

    function scheduleSelectorCheck(delay = 500) {
        if (selectorCheckTimer) return;
        selectorCheckTimer = setTimeout(warnIfSelectorsBroken, delay);
    }

    function checkRoute() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        debug("route/chat changed", lastUrl);
        updateSidebarCurrentStyle();
        queueReconcile();
        scheduleSelectorCheck(1200);
    }

    function setPaused(nextPaused) {
        if (paused === nextPaused) return;
        paused = nextPaused;

        if (paused) {
            if (frameRequest) cancelAnimationFrame(frameRequest);
            if (reconcileRequest) cancelAnimationFrame(reconcileRequest);
            frameRequest = 0;
            reconcileRequest = 0;
            pendingTurns.clear();

            for (const turn of document.querySelectorAll(`${TURN_SELECTOR}, .saevyn-turn`)) {
                for (const timers of [clearTimers, settleTimers, retryTimers]) {
                    const timer = timers.get(turn);
                    if (timer) clearTimeout(timer);
                    timers.delete(turn);
                }
                retryAttempts.delete(turn);
                clearClassification(turn);
            }
            for (const header of document.querySelectorAll(GENERATED_HEADER_SELECTOR)) {
                header.remove();
            }

            removeFiligree();
            document.body.classList.remove("saevyn-active");
            restoreFavicon();
            document.documentElement.dataset.saevynPaused = "true";
            console.info(`[Saevyn ${SAEVYN_VERSION}] paused — native ChatGPT restored.`);
            return;
        }

        delete document.documentElement.dataset.saevynPaused;
        document.body.classList.add("saevyn-active");
        syncFavicon();
        queueFiligree();
        console.info(`[Saevyn ${SAEVYN_VERSION}] resumed.`);
        queueReconcile();
    }

    function repairEditionRuntime() {
        mountReverieSky();
        ensureReverieSymbols();
        ensureTidepoolFilter();
        queueFiligree();
    }

    function repairRuntimeShell() {
        if (paused || !document.body) return;
        const root = document.documentElement;
        const runtimeIntact =
            root.getAttribute("data-saevyn-runtime") === SAEVYN_VERSION &&
            root.classList.contains("saevyn-root") &&
            document.body.classList.contains("saevyn-active") &&
            document.getElementById("saevyn-styles") &&
            document.getElementById(COMMUNITY_SETTINGS_HOST_ID);
        if (runtimeIntact) return;

        root.setAttribute("data-saevyn-runtime", SAEVYN_VERSION);
        injectStyles();
        applyThemeConfiguration();
        mountCommunitySettings();
        repairEditionRuntime();
        updateSidebarCurrentStyle();
        syncFavicon();
        queueReconcile();
        debug("repaired ChatGPT shell hydration");
    }

    communitySettings = loadCommunitySettings();
    injectStyles();
    applyThemeConfiguration();
    installClipboardGuard();
    mountCommunitySettings();
    installReverieRuntime();
    updateSidebarCurrentStyle();
    syncFavicon();
    queueReconcile();
    scheduleSelectorCheck(6000);

    const observer = new MutationObserver(records => {
        for (const record of records) {
            // Our speaker headers and injected UI also mutate the document.
            // Do not feed those changes back into the turn reconciler.
            if (mutationIsSaevynGenerated(record)) continue;

            if (record.type === "characterData") {
                queueTurnFromNode(record.target, mutationDeclaresSpeaker(record.target));
                continue;
            }

            queueTurnFromNode(record.target);
            for (const addedNode of record.addedNodes) {
                queueTurnFromNode(addedNode);
            }
        }
        checkRoute();
        queueFiligree();
        if (mutationsTouchFavicon(records)) syncFavicon();
        scheduleSelectorCheck();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
    });

    window.addEventListener("popstate", () => {
        checkRoute();
        queueReconcile();
    });

    window.addEventListener("pageshow", queueReconcile);
    // ChatGPT can replace its hydrated app shell after document-start.
    setInterval(repairRuntimeShell, 750);
    window.addEventListener("keydown", event => {
        if (
            event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey &&
            event.code === "KeyC"
        ) {
            event.preventDefault();
            event.stopPropagation();
            setPaused(!paused);
        }
    }, true);
    debug("ready");
})();
