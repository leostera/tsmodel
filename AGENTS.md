# Agent instructions

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: the layout, the commands, how releases and
deploys work, and the compatibility tsmodel keeps with repositories set up for Feynman.

- Run `bun run test` and `bun run typecheck` before you commit.
- A change to the package goes in `packages/tsmodel/CHANGELOG.md`, under the next release. A
  change to the site, the explorer or the repository goes in `CHANGELOG.md`, under today's date.
- The root `README.md` is for people who use tsmodel: what it does for them, and how to start.
  Keep how the repository works in CONTRIBUTING.md. `packages/tsmodel/README.md` is a copy of
  the root README; update both together.
- Never commit `.cloudflare/` or `dist/` directories: they are build output and local state.
- Snippets on the site (`sites/tsmodel.leostera.dev/snippets`) are real: a `*-check.txt` is
  what the CLI printed for the spec beside it. Rerun the command when either changes.
