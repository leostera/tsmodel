// One build of one repository at one commit (or commit prefix), in its own container: clone,
// `feynman build`, and put the page in R2. The Durable Object's name is the job, so requests for
// the same page while it builds find that build running instead of starting another.
//
// A build takes minutes (it checks every spec), so nobody waits for it: `start` begins it and
// answers at once, and the build goes on in the background (ctx.waitUntil). Visitors are shown
// the ref's previous page, or a page that reloads until this one is in R2.
import { Files, SandboxFileError } from "@cloudflare/sandbox";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { GATE_NAME, type ShareGate } from "./gate.ts";
import { pageKey, putFailure, putLatest, putPage } from "./pages.ts";
import { asCommit, type Commit } from "./refs.ts";
import type { Repository } from "./repository.ts";
import type { ShareEnv } from "./env.ts";
import { type OutboundProps, type ShareExports, shareExports } from "./exports.ts";

export interface BuildJob {
  readonly repository: Repository;
  /** The URL the remote answered on, with or without `.git`. */
  readonly cloneUrl: string;
  /** A full commit, or a prefix of one that only a clone can resolve. */
  readonly target: string;
  /** The branch, tag or HEAD asked for, whose latest page this becomes; none when a commit was. */
  readonly ref?: string;
}

/** What `start` did: a build is running (this one, or one already under way), or why none could start. */
export type StartResult =
  | { state: "building" }
  /** The client started too many builds lately (SHARE_BUILDS). */
  | { state: "limited" }
  /** The gate refused: another build is running, or today's builds are spent. */
  | { state: "busy" | "budget"; retryAfterSeconds: number };

type BuildResult =
  | { ok: true; commit: Commit }
  /** The repository or its specs (404, 422), or the sandbox (500). */
  | { ok: false; status: 404 | 422 | 500; message: string; log: string };

const REPO = "/workspace/repo";
const PAGE = "/workspace/out/index.html";
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1_000;
// A Durable Object stays in memory for a pending operation for at most 15 minutes from when it
// starts (exec's output is one, ctx.waitUntil another), so a build must end well within that.
// The gate's lease (gate.ts) outlasts a fetch and a build together.
const FETCH_TIMEOUT_S = 120;
const BUILD_TIMEOUT_S = 780;
const LOG_TAIL = 8_000;

// HTTPS leaves the container only through ShareOutbound, which re-signs it with this CA. exec() does
// not inherit start()'s environment, so every command gets it.
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const ENV = {
  GIT_SSL_CAINFO: CA,
  SSL_CERT_FILE: CA,
  NODE_EXTRA_CA_CERTS: CA,
  // A private or missing repository asks for credentials; fail instead of waiting for them.
  GIT_TERMINAL_PROMPT: "0",
  NO_COLOR: "1",
};

// $1 url, $2 commit or prefix. Prints the full commit. A shallow fetch of one commit is what most
// hosts allow for a full id; a prefix, or a host that does not, gets a blobless clone of every
// branch and tag to look it up in.
const FETCH = `set -eu
rm -rf ${REPO} /workspace/out && mkdir -p ${REPO} /workspace/out && cd ${REPO}
git init -q && git remote add origin "$1"
if timeout ${FETCH_TIMEOUT_S} git fetch -q --depth 1 origin "$2" 2>/dev/null; then
  git rev-parse --verify 'FETCH_HEAD^{commit}'
  exit 0
fi
timeout ${FETCH_TIMEOUT_S} git fetch -q --filter=blob:none --tags origin '+refs/heads/*:refs/remotes/origin/*'
git rev-parse --verify --quiet "$2^{commit}" || { echo "$2 is not one commit in $1" >&2; exit 3; }`;

// $1 commit. Exit 1 with a page means some specs did not load: the page shows them as errors.
const BUILD = `set -eu
cd ${REPO}
git -c advice.detachedHead=false checkout -q "$1"
exec timeout ${BUILD_TIMEOUT_S} feynman build --out ${PAGE}`;

export class ShareBuilder extends DurableObject<ShareEnv> {
  readonly #container: Container;
  readonly #files: Files;
  readonly #exports: ShareExports;
  /** The build under way, if any. */
  #pending: Promise<void> | null = null;
  /** A start deciding whether it may build: callers meanwhile share its answer. */
  #starting: Promise<StartResult> | null = null;

  constructor(ctx: DurableObjectState, env: ShareEnv) {
    super(ctx, env);
    if (!ctx.container) throw new Error("ShareBuilder has no container attached: give its export container: shareContainer");
    this.#container = ctx.container;
    this.#files = new Files(this.#container);
    this.#exports = shareExports(ctx);
  }

  /**
   * Begin building `job` unless a build of it is under way, and answer without waiting for it.
   * A new build counts against `client`'s build limit; finding one under way does not, so a
   * page that reloads while it waits costs nothing.
   */
  start(job: BuildJob, client: string): Promise<StartResult> {
    if (this.#pending) return Promise.resolve({ state: "building" });
    this.#starting ??= this.#begin(job, client).finally(() => (this.#starting = null));
    return this.#starting;
  }

  async #begin(job: BuildJob, client: string): Promise<StartResult> {
    const { success } = await this.env.SHARE_BUILDS.limit({ key: client });
    if (!success) return { state: "limited" };
    const name = `${job.repository.id}@${job.target}`;
    const gate = this.#exports.ShareGate.getByName(GATE_NAME);
    const decision = await gate.acquire(name);
    if (!decision.ok) {
      console.log({ event: "build.refused", repository: job.repository.id, target: job.target, reason: decision.reason });
      return { state: decision.reason, retryAfterSeconds: decision.retryAfterSeconds };
    }
    this.#pending = this.#build(job, name, gate).finally(() => (this.#pending = null));
    this.ctx.waitUntil(this.#pending);
    return { state: "building" };
  }

  async #build(job: BuildJob, name: string, gate: DurableObjectStub<ShareGate>): Promise<void> {
    try {
      const result = await this.#runBuild(job);
      // A repository that is not there, or whose specs do not build, says so again for a while
      // without another container; a sandbox that failed, for a few minutes.
      if (!result.ok) await putFailure(this.env.SHARE_PAGES, job.repository, job.target, { status: result.status, message: result.message, log: result.log });
      else if (job.ref) await putLatest(this.env.SHARE_PAGES, job.repository, job.ref, { key: pageKey(job.repository, result.commit), commit: result.commit });
    } catch (cause) {
      console.log({ event: "build.error", repository: job.repository.id, target: job.target, error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause) });
    } finally {
      await gate.release(name);
    }
  }

  async #runBuild(job: BuildJob): Promise<BuildResult> {
    const started = Date.now();
    const log = (event: string, fields: Record<string, unknown> = {}) =>
      console.log({ event, repository: job.repository.id, target: job.target, ms: Date.now() - started, ...fields });
    try {
      await this.#start(job.repository);
      log("build.fetch");
      const fetched = await this.#run(["/bin/sh", "-c", FETCH, "fetch", job.cloneUrl, job.target]);
      const commit = asCommit(fetched.stdout.trim());
      if (fetched.exitCode !== 0 || !commit) {
        log("build.fetch.failed", { exitCode: fetched.exitCode });
        return failure(fetched.exitCode === 3 ? 404 : 422, `could not fetch ${job.target} from ${job.cloneUrl}`, fetched);
      }
      // A prefix can name a commit built under its full id already.
      if (await this.env.SHARE_PAGES.head(pageKey(job.repository, commit))) return { ok: true, commit };
      log("build.feynman", { commit });
      const built = await this.#run(["/bin/sh", "-c", BUILD, "build", commit]);
      const page = await this.#read(PAGE);
      if (!page || built.exitCode > 1) {
        log("build.feynman.failed", { commit, exitCode: built.exitCode });
        return failure(422, `feynman build failed for ${job.repository.id} at ${commit.slice(0, 12)}`, built);
      }
      await putPage(this.env.SHARE_PAGES, job.repository, commit, page);
      log("build.stored", { commit, bytes: page.byteLength, exitCode: built.exitCode });
      return { ok: true, commit };
    } catch (cause) {
      log("build.error", { error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause) });
      return { ok: false, status: 500, message: "the build sandbox failed", log: "" };
    } finally {
      // One container per build: nothing in it is worth keeping, and an idle one costs.
      if (this.#container.running) await this.#container.destroy().catch(() => {});
    }
  }

  async #start(repository: Repository): Promise<void> {
    if (this.#container.running) return;
    this.#container.start({
      image: this.#container.images.builder,
      // Four vCPUs: on standard-1's half of one, a repository with many specs took longer than
      // BUILD_TIMEOUT_S to check them all.
      instance: "standard-4",
      // Only HTTP and HTTPS leave, through ShareOutbound, and only to the repository's host: specs
      // run during the build, and they are code from the internet.
      enableInternet: false,
      labels: { app: "feynman-share" },
    });
    const outbound = this.#exports.ShareOutbound({ props: { host: repository.host } });
    await this.#container.interceptAllOutboundHttp(outbound);
    await this.#container.interceptOutboundHttps("*", outbound);
    await this.#container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
  }

  async #run(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const process = await this.#container.exec(argv, { cwd: "/workspace", env: ENV });
    const output = await process.output();
    const decoder = new TextDecoder();
    return { exitCode: output.exitCode, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
  }

  async #read(path: string): Promise<ArrayBuffer | null> {
    try {
      return await (await this.#files.readFile(path)).arrayBuffer();
    } catch (cause) {
      if (SandboxFileError.is(cause) && cause.code === "ENOENT") return null;
      throw cause;
    }
  }
}

function failure(status: 404 | 422, message: string, output: { stdout: string; stderr: string }): BuildResult {
  return { ok: false, status, message, log: `${output.stdout}\n${output.stderr}`.trim().slice(-LOG_TAIL) };
}

/** Where the build container's traffic goes: HTTPS to the repository's host, and nowhere else. */
export class ShareOutbound extends WorkerEntrypoint<ShareEnv, OutboundProps> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.hostname !== this.ctx.props.host) {
      console.log({ event: "outbound.denied", host: url.hostname, allowed: this.ctx.props.host });
      return new Response(`the build sandbox may only reach https://${this.ctx.props.host}\n`, { status: 403 });
    }
    return fetch(request);
  }
}
