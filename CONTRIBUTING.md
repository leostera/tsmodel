# Contributing to tsmodel

How the repository is laid out, and how to build, test, release and deploy it. What tsmodel is
for is in the [README](README.md).

## Layout

- [`packages/tsmodel`](packages/tsmodel): `@tsmodel/tsmodel` on npm, the library and CLI,
  with its [CHANGELOG](packages/tsmodel/CHANGELOG.md), examples, tests, and the agent skill
  ([`skills/tsmodel/SKILL.md`](packages/tsmodel/skills/tsmodel/SKILL.md)). Its README is a
  copy of the root one.
  - `src/spec`: the DSL and the engine (world, events, clock, drafts), and traces.
  - `src/check`: the checker: exploration, properties, shrinking, coverage, `conform` and
    traces.
  - `src/code`: sources, anchors, the lock, and call trees.
  - `src/cli`: the CLI, and loading specs from any repository.
  - `src/play`: the playground kit specs' playground files use.
  - `src/view`: the browser view, built into `dist/view`.
  - `examples/`: well-known systems, each with a bug and its fix; `examples/oracles/`
    has TLA+, P, Alloy, Spin, NuSMV and Quint models of them that check the checker.
- [`packages/share`](packages/share) (`@tsmodel/share`): the explorer of any public git
  repository, built on demand in a sandbox and kept in R2 by commit. The site mounts it under
  `/s/`.
- [`sites/tsmodel.leostera.dev`](sites/tsmodel.leostera.dev) (`@tsmodel/site`): the website,
  prerendered React, and the Worker that serves the explorer.
- [`sites/feynman.leostera.dev`](sites/feynman.leostera.dev): a Worker that redirects the
  site's old domain, from before the rename, to the new one.
- [`book`](book/README.md): *Writing specs with tsmodel*, with every spec it builds in
  [`book/specs`](book/specs).
- [`docs/rfds`](docs/rfds): design documents, one per decision, numbered.
- [`CHANGELOG.md`](CHANGELOG.md): what changed in the site, the explorer and the repository,
  by date. The package's changes go in its own changelog, by release.

## Build and test

```sh
bun install
bun run test            # both packages, but not the oracles
bun run typecheck
bun run tsmodel check   # the examples (tsmodel.config.ts)
bun run tsmodel dev     # the examples in the playground
```

- `bun run oracles` checks the examples against the other model checkers. It needs them
  installed (TLC, P, and the rest), and takes a while.
- `bun run bench` and `bun run fuzz` measure the checker and fuzz the engine.

## Compatibility

Repositories set up before the rename from Feynman keep working, and must keep working:
specs that import `@leostera/feynman` load (`src/cli/names.ts`), `feynman.config.ts` and
`feynman.lock` are read when the new files are missing, and `feynman.*` span attributes are
read as `tsmodel.*` (`src/check/trace.ts`). `test/cli/cli.test.ts` and
`test/check/trace.test.ts` cover this.

## Releasing the package

1. Bump `version` in `packages/tsmodel/package.json`, and write the release in
   `packages/tsmodel/CHANGELOG.md`. A release that changes how specs are written has a
   **Migrating** section, with what to change, before and after.
2. Set `TSMODEL_VERSION` in `packages/share/src/pages.ts`, and the same version in
   `packages/share/Dockerfile`, so the explorer builds pages with the new release.
3. From `packages/tsmodel`, run `npm publish --access public --auth-type=web`. Publishing
   builds the view, type-checks and tests first (`prepublishOnly`), then asks you to approve
   it in the browser.

## Deploying the site

The site and the explorer are deployed, not released: add a dated entry to `CHANGELOG.md`.

```sh
cd sites/tsmodel.leostera.dev
bun run deploy
```

- The deploy builds the explorer's container image, so Docker needs to be running.
- If pushing the image to `registry.cloudflare.com` times out on its largest layer, push it
  with [crane](https://github.com/google/go-containerregistry/tree/main/cmd/crane):
  `docker save <image> -o image.tar && crane push image.tar <image>`, then deploy again.
- `sites/feynman.leostera.dev` deploys the same way, and rarely needs to.

The page is prerendered at build time (`scripts/render.tsx`), and code snippets are
highlighted then (`scripts/highlight.ts`). It follows the system's light or dark setting.
Every two-column row splits on the page's centre line, and the four-column grid shares those
edges, so keep new rows on `.split` and `.quarters` in `src/index.css`.

## Writing

- Specs, docs, the book and the site say what something does, in plain sentences, for
  someone who hasn't read the code.
- Design changes start as an RFD in `docs/rfds`, numbered after the last one.
