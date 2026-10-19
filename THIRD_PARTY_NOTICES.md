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
