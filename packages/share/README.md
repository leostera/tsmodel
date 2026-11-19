# @tsmodel/share

This package serves the tsmodel explorer of any public git repository. It is a [Hono](https://hono.dev) app that the site Worker (`sites/tsmodel.leostera.dev`) mounts at `/s`:

```
https://tsmodel.leostera.dev/s/github.com/leostera/tsmodel?ref=main
https://tsmodel.leostera.dev/s/gitlab.com/group/sub/project?ref=v1.2.0
https://tsmodel.leostera.dev/s/codeberg.org/user/repo?ref=01fa5df
```

`ref` is a branch, a tag, a full ref, or a commit (full or abbreviated). Leave it out to get the default branch (HEAD).

## How a request is served

1. **Parse the path** (`src/repository.ts`). The host must be a public DNS name, and the path must be plain segments. The result is `https://<host>/<path>`.
2. **Resolve `ref`** (`src/refs.ts`). The Worker asks the host for its branches, tags and HEAD, which is `git ls-remote` over git's smart HTTP protocol, and finds the commit. It uses protocol v2's `ls-refs` with ref prefixes, so the host sends no pull-request refs. Hosts without v2 get the v0 listing, read up to 4 MB. Each URL is also tried with `.git` appended. No sandbox is needed for this step.
3. **Serve from R2** if `pages/<host>/<path>/<commit>.html` exists.
4. **Otherwise start building it** (`src/builder.ts`), and answer without waiting. The `ShareBuilder` Durable Object is named `<host>/<path>@<commit>`, so concurrent requests for the same page find one build. It starts a container from `Dockerfile` (Bun, git and the published `@tsmodel/tsmodel`) on a `standard-4` instance. The container fetches that one commit (`git fetch --depth 1`), or does a blobless clone when it must resolve an abbreviated commit. Then it runs `tsmodel build`, which checks every spec and can take several minutes, puts the page in R2 and destroys the container. The build runs in the background (`ctx.waitUntil`), and must end within the 15 minutes a Durable Object stays in memory for one pending operation: the fetch has 2 minutes, `tsmodel build` 13.
5. **Answer while it builds.** A branch, tag or HEAD shows its previous page: the last one built for that ref (`latest/<host>/<path>/<ref>.json` in R2), uncached, since a newer one is coming. HEAD of a repository with no such record shows the newest page in R2 for it, by any tsmodel. Anything else, a commit or a ref with no page yet, gets a `202` page that reloads itself until the page is in R2.

Before a build, the Worker checks R2 for a recent failure for that commit. A ref whose newest commit failed to build shows its previous page too. Starting a build counts against the client's build limit; finding one under way does not, so a page that reloads while it waits costs nothing.

## Limits

These limits cap how much anyone can make the service spend:

| Limit | Where | Value |
| ----- | ----- | ----- |
| Requests per client IP | `SHARE_REQUESTS` rate limit, on every request under `/s` | 60 a minute, then 429 |
| Builds per client IP | `SHARE_BUILDS` rate limit, only when a build starts | 2 a minute, then the waiting page reloads after a minute |
| Builds at once | `ShareGate` (`src/gate.ts`), one Durable Object for the service | 1; the waiting page reloads every 35 seconds until its build starts |
| Builds a day | `ShareGate` | 200 per UTC day, then 503 until midnight UTC |
| Failed builds | `failures/<version>/<host>/<path>/<target>.json` in R2 | answered from R2 for an hour, or 5 minutes when the sandbox failed |
| Branch and tag listing | `src/refs.ts` | 4 MB |

Pages already in R2 still load when the build limits are reached. The concurrency and daily limits are constants in `src/gate.ts`. The rate limits are in `config.ts`.

A page built from a full commit is served with `immutable` caching. A page found through a branch or tag is cached for 60 seconds, so it picks up new commits. A previous page standing in for a ref's newest commit is not cached.

The build runs spec code from the internet, so the container has no direct internet access (`enableInternet: false`). All of its HTTP and HTTPS traffic goes through the `ShareOutbound` entrypoint, which only allows HTTPS to the repository's own host.

## Mounting it

The package has no Worker of its own. The Worker that mounts it does three things:

- **Routes it.** In `worker/index.ts`:

  ```ts
  import { share } from "@tsmodel/share";
  export { ShareBuilder, ShareGate, ShareOutbound } from "@tsmodel/share";

  app.route("/s", share);
  ```

- **Declares the resources.** `@tsmodel/share/config` (`config.ts`) describes them for `cloudflare.config.ts`:

  ```ts
  import { shareBindings, shareContainer, shareExports } from "@tsmodel/share/config";

  worker: { env: { ...shareBindings() }, exports: { ...shareExports } },
  containers: [shareContainer],
  ```

  These are the `SHARE_PAGES` R2 bucket (`tsmodel-share`), the two rate limits, the `ShareBuilder` and `ShareGate` Durable Objects, and the container that `ShareBuilder` starts. share reaches `ShareBuilder`, `ShareGate` and `ShareOutbound` through `ctx.exports`, not bindings. cf refuses a container on a Durable Object that the Worker binds to by its own name.

- **Runs before its assets on the mount path.** Set `assets.runWorkerFirst: ["/s/*"]`. Without it, the asset handler answers unmatched paths with its 404 page, and the request never reaches the Worker.

## Develop

```sh
bun run test        # path and ref parsing
bun run typecheck
```

To run it end to end, run `cf dev` in `sites/tsmodel.leostera.dev` with Docker running. It builds the container image and uses a local R2.

To update tsmodel in the sandbox, change `TSMODEL_VERSION` in `Dockerfile`. Pages already in R2 stay as they were built. Delete their objects to rebuild them.
