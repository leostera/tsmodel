// <mount>/<host>/<path>?ref=<branch, tag or commit>: the Feynman explorer of a public git
// repository. The ref resolves to a commit with one request to the git host; a commit that has
// a page in R2 is served from there, and any other is built in a sandbox in the background.
// Until it is built, a branch, tag or HEAD shows its previous page, and anything else a page
// that reloads itself until the build is done.
//
// What it costs is bounded in layers: every request counts against its IP (SHARE_REQUESTS); a
// request that starts a build counts against a tighter one (SHARE_BUILDS); a failed build answers
// from R2 for a while; and ShareGate lets one build run at a time, and so many a day.
import { Hono } from "hono";
import type { BuildJob, StartResult } from "./builder.ts";
import type { ShareEnv } from "./env.ts";
import { type ShareExports, shareExports } from "./exports.ts";
import { buildingPage, errorPage, getFailure, getLatest, pageKey, pageResponse } from "./pages.ts";
import { asCommit, lsRemote, type RemoteLookup, resolveRef } from "./refs.ts";
import { parseRepository, type Repository } from "./repository.ts";

/** What a client over a rate limit is told to wait: the limits count per minute. */
const LIMITED_RETRY_S = 60;
/**
 * How often a page waiting for another build reloads: each reload tries to start its build, and
 * SHARE_BUILDS allows two a minute per client.
 */
const QUEUED_REFRESH_S = 35;

/** Mount it with `app.route("/s", share)`. GET serves pages; Hono answers HEAD from it. */
export const share = new Hono<{ Bindings: ShareEnv }>();

share.use(async (c, next) => {
  const { success } = await c.env.SHARE_REQUESTS.limit({ key: clientOf(c.req.raw) });
  if (!success) return tooMany("Too many requests", "Wait a minute and try again.");
  await next();
});

share.get("/", () => errorPage(404, "Name a repository", "For example /s/github.com/leostera/feynman?ref=main."));

share.get("/:repository{.+}", (c) => {
  const parsed = parseRepository(c.req.param("repository"));
  if (!parsed.ok) return errorPage(400, "Not a repository", parsed.reason);
  const request: ShareRequest = { env: c.env, exports: shareExports(c.executionCtx), client: clientOf(c.req.raw), remote: lsRemote };
  return serve(request, parsed.repository, c.req.query("ref") ?? null);
});

export interface ShareRequest {
  readonly env: ShareEnv;
  readonly exports: Pick<ShareExports, "ShareBuilder">;
  /** The client's IP, which the rate limits count by. */
  readonly client: string;
  /** Lists the repository's branches and tags (lsRemote). */
  readonly remote: (url: string) => Promise<RemoteLookup>;
}

export async function serve(request: ShareRequest, repository: Repository, ref: string | null): Promise<Response> {
  const { env } = request;
  const lookup = await request.remote(repository.url);
  if (!lookup.ok) return errorPage(404, "Repository not found", lookup.reason);
  const resolution = resolveRef(lookup.remote.refs, ref);
  if (resolution.kind === "missing") {
    return errorPage(404, "Ref not found", `${repository.id} has no branch, tag or commit named ${JSON.stringify(ref ?? "HEAD")}.`);
  }
  // Only a ref that is a commit names the same page forever. Any other moves, and its previous
  // page can stand in for it while its newest commit builds.
  const immutable = asCommit(ref?.trim().toLowerCase() ?? "") !== null;
  const tracked = immutable || resolution.kind === "abbreviated" ? undefined : ref?.trim() || "HEAD";
  if (resolution.kind === "commit") {
    const stored = await env.SHARE_PAGES.get(pageKey(repository, resolution.commit));
    if (stored) return pageResponse(stored, resolution.commit, immutable ? "immutable" : "ref");
  }
  const target = resolution.kind === "commit" ? resolution.commit : resolution.prefix;
  const standIn = async (): Promise<Response | null> => {
    const latest = tracked === undefined ? null : await getLatest(env.SHARE_PAGES, repository, tracked);
    return latest && pageResponse(latest.object, latest.commit, "standIn");
  };
  const failed = await getFailure(env.SHARE_PAGES, repository, target);
  if (failed) return (await standIn()) ?? errorPage(failed.status, failed.message, failed.status === 500 ? "This build failed in the last few minutes." : "This build failed within the last hour.", failed.log);
  const job: BuildJob = { repository, cloneUrl: lookup.remote.url, target, ...(tracked === undefined ? {} : { ref: tracked }) };
  const started = await request.exports.ShareBuilder.getByName(`${repository.id}@${target}`).start(job, request.client);
  return (await standIn()) ?? waiting(repository, target, started);
}

/**
 * The answer while `target` is not built, when no earlier page can stand in for it. A build that
 * could not start yet is tried again when the page reloads: after the build ahead of it (busy),
 * or after a minute (the client's build limit, which counts per minute).
 */
function waiting(repository: Repository, target: string, started: StartResult): Response {
  switch (started.state) {
    case "building":
      return buildingPage(repository, target, { state: "building" });
    case "busy":
      return buildingPage(repository, target, { state: "queued", refreshSeconds: QUEUED_REFRESH_S });
    case "limited":
      return buildingPage(repository, target, { state: "queued", refreshSeconds: LIMITED_RETRY_S });
    case "budget":
      return errorPage(503, "Today's builds are spent", "Pages that are already built still load. Try again tomorrow.", "", started.retryAfterSeconds);
  }
}

function tooMany(title: string, detail: string): Response {
  return errorPage(429, title, detail, "", LIMITED_RETRY_S);
}

/** The client's IP, as Cloudflare saw it. Local development has none, and counts as one client. */
function clientOf(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}
