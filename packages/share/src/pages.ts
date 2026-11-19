// Built pages in R2, one per repository and commit, and the pages shown when there is none.
import type { Commit } from "./refs.ts";
import type { Repository } from "./repository.ts";

/**
 * The tsmodel the builder installs (the Dockerfile's TSMODEL_VERSION; a test keeps them equal).
 * A page depends on it as much as on the commit: a spec using what an older tsmodel lacks
 * fails to build there, and a newer one checks and draws differently.
 */
export const TSMODEL_VERSION = "0.17.0";

/** `pages/0.17.0/github.com/leostera/tsmodel/<commit>.html`: a commit's page, built by one tsmodel, never changes. */
export function pageKey(repository: Repository, commit: Commit): string {
  return `pages/${TSMODEL_VERSION}/${repository.id}/${commit}.html`;
}

export async function putPage(bucket: R2Bucket, repository: Repository, commit: Commit, page: ArrayBuffer): Promise<void> {
  await bucket.put(pageKey(repository, commit), page, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: { repository: repository.id, commit, builtAt: new Date().toISOString() },
  });
}

// The latest page of a ref --------------------------------------------------------------------------

/**
 * The last page built for a branch, a tag, or HEAD: what a visitor sees while the ref's newest
 * commit builds, or after its build failed. It names the page by key, so it can be one an older
 * tsmodel built.
 */
export interface Latest {
  readonly key: string;
  readonly commit: Commit;
}

/** `latest/github.com/leostera/tsmodel/HEAD.json`. The ref is encoded: `a/b` with ref `c/d` is not `a/b/c` with ref `d`. */
export function latestKey(repository: Repository, ref: string): string {
  return `latest/${repository.id}/${encodeURIComponent(ref)}.json`;
}

export async function putLatest(bucket: R2Bucket, repository: Repository, ref: string, latest: Latest): Promise<void> {
  await bucket.put(latestKey(repository, ref), JSON.stringify(latest), { httpMetadata: { contentType: "application/json" } });
}

/**
 * The last page built for `ref`, if it is still in R2. HEAD, which is what links to a repository
 * open, falls back to the newest page of the repository by any tsmodel, for repositories whose
 * pages were built before refs were tracked; the answer is kept as HEAD's latest.
 */
export async function getLatest(bucket: R2Bucket, repository: Repository, ref: string): Promise<{ object: R2ObjectBody; commit: Commit } | null> {
  const pointer = await bucket.get(latestKey(repository, ref));
  const latest = pointer ? asLatest(await pointer.json().catch(() => null)) : null;
  if (latest) {
    const object = await bucket.get(latest.key);
    if (object) return { object, commit: latest.commit };
  }
  if (ref !== "HEAD") return null;
  const newest = await newestPage(bucket, repository);
  if (!newest) return null;
  const object = await bucket.get(newest.key);
  if (!object) return null;
  await putLatest(bucket, repository, ref, newest);
  return { object, commit: newest.commit };
}

/** How many pages of a listing to read per tsmodel version, looking for a repository's newest page. */
const LIST_PAGES = 5;

/** The page of `repository` stored most recently, by any tsmodel. */
async function newestPage(bucket: R2Bucket, repository: Repository): Promise<Latest | null> {
  const versions = await bucket.list({ prefix: "pages/", delimiter: "/" });
  let newest: { latest: Latest; uploaded: number } | null = null;
  for (const version of versions.delimitedPrefixes) {
    let cursor: string | undefined;
    for (let page = 0; page < LIST_PAGES; page++) {
      const listed = await bucket.list({ prefix: `${version}${repository.id}/`, cursor });
      for (const object of listed.objects) {
        const commit = /\/([0-9a-f]{40})\.html$/.exec(object.key)?.[1] as Commit | undefined;
        // `<repo>/<commit>.html` only: a nested repository's pages sit under this prefix too.
        if (!commit || object.key !== `${version}${repository.id}/${commit}.html`) continue;
        if (!newest || object.uploaded.getTime() > newest.uploaded) newest = { latest: { key: object.key, commit }, uploaded: object.uploaded.getTime() };
      }
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
  }
  return newest?.latest ?? null;
}

function asLatest(value: unknown): Latest | null {
  if (typeof value !== "object" || value === null) return null;
  const { key, commit } = value as Record<string, unknown>;
  return typeof key === "string" && typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit) ? { key, commit: commit as Commit } : null;
}

// Failed builds -------------------------------------------------------------------------------------

/**
 * A build that failed, kept for a while so that asking again does not start another: for an
 * hour when the repository or its specs are at fault (404, 422), and a few minutes when the
 * sandbox was (500), which may work again soon.
 */
export interface Failure {
  readonly status: 404 | 422 | 500;
  readonly message: string;
  readonly log: string;
}

const FAILURE_TTL_MS = 60 * 60 * 1_000;
const SANDBOX_FAILURE_TTL_MS = 5 * 60 * 1_000;

/** `failures/<version>/<host>/<path>/<target>.json`: the target as asked for, a commit or a prefix. */
function failureKey(repository: Repository, target: string): string {
  return `failures/${TSMODEL_VERSION}/${repository.id}/${target}.json`;
}

export async function putFailure(bucket: R2Bucket, repository: Repository, target: string, failure: Failure): Promise<void> {
  await bucket.put(failureKey(repository, target), JSON.stringify(failure), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { failedAt: String(Date.now()) },
  });
}

/** A failure recorded recently enough to stand (FAILURE_TTL_MS, SANDBOX_FAILURE_TTL_MS), or null. */
export async function getFailure(bucket: R2Bucket, repository: Repository, target: string): Promise<Failure | null> {
  const object = await bucket.get(failureKey(repository, target));
  if (!object) return null;
  const failedAt = Number(object.customMetadata?.failedAt);
  const parsed: unknown = await object.json().catch(() => null);
  if (!isFailure(parsed)) return null;
  const ttl = parsed.status === 500 ? SANDBOX_FAILURE_TTL_MS : FAILURE_TTL_MS;
  return Date.now() - failedAt < ttl ? parsed : null;
}

function isFailure(value: unknown): value is Failure {
  if (typeof value !== "object" || value === null) return false;
  const { status, message, log } = value as Record<string, unknown>;
  return (status === 404 || status === 422 || status === 500) && typeof message === "string" && typeof log === "string";
}

// Responses -----------------------------------------------------------------------------------------

/** What a shared page may do: run its scripts and open links, in an origin that is not this site's. */
export const PAGE_SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";

/**
 * How long a page may be cached: a commit's page forever; a branch's for a minute, since it
 * moves; a page that stands in for a ref's newest commit not at all, since a newer one is coming.
 */
export type PageCaching = "immutable" | "ref" | "standIn";

const CACHE_CONTROL: Record<PageCaching, string> = {
  immutable: "public, max-age=31536000, immutable",
  ref: "public, max-age=60",
  standIn: "no-cache",
};

/** A stored page as the response to a share URL. */
export function pageResponse(object: R2ObjectBody, commit: Commit, caching: PageCaching): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-tsmodel-commit", commit);
  // The page runs the repository's specs, which is anyone's JavaScript. Sandboxed, it runs in
  // an origin of its own: it cannot read what this site stores, or ask this site for anything
  // as the visitor. Its links still open, in tabs that are not sandboxed.
  headers.set("content-security-policy", PAGE_SANDBOX);
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", CACHE_CONTROL[caching]);
  return new Response(object.body, { headers });
}

/**
 * The answer while a page waits for its build and there is no earlier one to show: it says so
 * and reloads itself, every `refreshSeconds`, until the page is in R2. A page that waits to
 * start reloads slowly enough that its reloads stay under the per-client build limit.
 */
export function buildingPage(repository: Repository, target: string, waiting: { state: "building" } | { state: "queued"; refreshSeconds: number }): Response {
  const short = /^[0-9a-f]{40}$/.test(target) ? target.slice(0, 12) : target;
  const building = waiting.state === "building";
  const detail = building
    ? `tsmodel is building the explorer of ${repository.id} at ${short}. It checks every spec, which takes a few minutes; this page reloads itself until it is ready.`
    : `The explorer of ${repository.id} at ${short} builds after the one building now. This page reloads itself until it is ready.`;
  const response = errorPage(202, building ? "Building the explorer" : "Waiting to build the explorer", detail);
  response.headers.set("refresh", String(building ? BUILDING_REFRESH_S : waiting.refreshSeconds));
  return response;
}

/** How often a page whose build is under way reloads itself, in seconds. */
export const BUILDING_REFRESH_S = 15;

export function errorPage(status: number, title: string, detail = "", log = "", retryAfterSeconds?: number): Response {
  const body = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · tsmodel</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 4rem auto; padding: 0 1.5rem; color: #1f2328; }
  pre { background: #f6f8fa; padding: 1rem; overflow: auto; font-size: 13px; border-radius: 6px; }
  code { font-size: 0.9em; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } pre { background: #161b22; } }
</style>
<h1>${escape(title)}</h1>
${detail ? `<p>${escape(detail)}</p>` : ""}
${log ? `<pre>${escape(log)}</pre>` : ""}
<p><a href="https://tsmodel.leostera.dev">tsmodel</a> serves the explorer of any public repository at
<code>/s/&lt;host&gt;/&lt;path&gt;?ref=&lt;branch, tag or commit&gt;</code>.</p>
</html>
`;
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  if (retryAfterSeconds !== undefined) headers.set("retry-after", String(retryAfterSeconds));
  return new Response(body, { status, headers });
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
