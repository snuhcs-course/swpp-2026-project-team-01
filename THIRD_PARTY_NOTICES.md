# Third-party notices

## eve chat template

The application skeleton (`agent/`, `apps/web/`, `vercel.ts`, `components.json`, `docs/`, `scripts/setup.sh` and `.agents/skills/{dashboard-chat-best-practices,eve-chat-template-eve}`) was copied from the eve chat template and is modified in this repository.

- Source: <https://github.com/vercel/eve>, path `apps/templates/eve-chat-template`
- Commit: `8c55ea7c132f9a23829214bda48069d710da77fa` (2026-10-08, "feat(eve): deferred tools and skills")
- License: Apache License, Version 2.0, <https://www.apache.org/licenses/LICENSE-2.0>

Not copied: the pnpm workspace file and lockfile, which the [foundation design](openspec/changes/application-foundation/design.md#1-base-template-and-revision) excludes, and the template's root `AGENTS.md`, `CLAUDE.md`, `README.md`, `.env.example`, `.gitignore`, `.vercelignore` and `package.json`, which this repository already owns. The template's ignore entries were merged into the repository's ignore files. Its `.npmrc` was copied and later removed with the dependency that needed it.

The upstream repository's `NOTICE` file reads in part:

```text
eve
Copyright 2026 Vercel, Inc. and contributors

This product includes software developed at Vercel, Inc.
(https://vercel.com/).
```

The remainder of that `NOTICE` covers the code-mode runtime bundled inside the `eve` npm package, which is installed as a dependency and not copied here.

## shadcn/ui and its AI Elements patterns

`apps/web/components/ui/{bubble,field,item,label,message,message-scroller,progress,questionnaire,trace}.tsx` were added with the shadcn CLI 4.22.1 on 2026-10-20 (the `trace` and `questionnaire` components from the `radix-rhea` style) and are modified here. `apps/web/app/shadcn.css` is copied from `shadcn@4.21.4` `dist/tailwind.css`.

- Source: <https://github.com/shadcn-ui/ui>, <https://ui.shadcn.com/docs/ai-elements>
- License: MIT License, Copyright (c) 2023 shadcn

## Noto Sans KR

`lib/server/fonts/NotoSansKR-Regular.woff` and `NotoSansKR-Bold.woff` are subsets of Noto Sans KR, bundled so the slot image (`lib/server/slot-preview-image.ts`) renders Korean without fetching fonts at runtime. They were made on 2026-11-09 from the variable font with fontTools 4.60.1: `fonttools varLib.instancer` at weights 400 and 700, then `pyftsubset` to Basic Latin, Latin-1, general punctuation, arrows, CJK symbols, Hangul compatibility jamo, all Hangul syllables and fullwidth forms (`U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+2190-2193,U+2212,U+3000-303F,U+3131-318E,U+AC00-D7A3,U+FF01-FF5E`), without hinting, as WOFF. The license is copied beside them as `lib/server/fonts/OFL.txt`.

- Source: <https://github.com/google/fonts>, file `ofl/notosanskr/NotoSansKR[wght].ttf`, last changed in commit `4efc2774c63917927efe769ca845def6bd6debae` (2022-12-09, "Noto Sans KR hotfix2")
- Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'
- License: SIL Open Font License, Version 1.1, <https://openfontlicense.org>

## Geist

`lib/server/fonts/Geist-Regular.ttf` and `Geist-SemiBold.ttf` are Geist 1.800 at weights 400 and 600, bundled so the slot image (`lib/server/slot-preview-image.ts`) renders without fetching fonts at runtime. They are the static TTF instances Google Fonts' CSS API (`fonts.googleapis.com/css2?family=Geist:wght@400` and `@600`) served on 2026-11-12, unmodified. The license is copied beside them as `lib/server/fonts/OFL.txt`.

- Source: <https://github.com/vercel/geist-font>, through Google Fonts
- Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)
- License: SIL Open Font License, Version 1.1, <https://openfontlicense.org>

## Instrument Serif

`lib/server/fonts/InstrumentSerif-Regular.ttf` and `InstrumentSerif-Italic.ttf` are Instrument Serif 1.000, bundled for the slot image's headline. They are the TTF files Google Fonts' CSS API (`fonts.googleapis.com/css2?family=Instrument+Serif` and `:ital@1`) served on 2026-11-12, unmodified. The license is copied beside them as `lib/server/fonts/OFL.txt`.

- Source: <https://github.com/Instrument/instrument-serif>, through Google Fonts
- Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)
- License: SIL Open Font License, Version 1.1, <https://openfontlicense.org>
