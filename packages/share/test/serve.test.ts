// What a share URL answers, from what R2 holds and what a build start says: a page that is
// built, the previous page of a ref while its newest commit builds, or a page that waits.
import { beforeEach, describe, expect, test } from "bun:test";
import { serve, type ShareRequest } from "../src/app.ts";
import type { BuildJob, StartResult } from "../src/builder.ts";
import type { ShareEnv } from "../src/env.ts";
import { FEYNMAN_VERSION, latestKey, pageKey } from "../src/pages.ts";
import type { Commit } from "../src/refs.ts";
import { parseRepository, type Repository } from "../src/repository.ts";

const OLD = "a".repeat(40) as Commit;
const NEW = "b".repeat(40) as Commit;
const OTHER = "c".repeat(40) as Commit;

function repository(route: string): Repository {
  const parsed = parseRepository(route);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.repository;
}
const AXO = repository("github.com/leostera/axo");

interface Stored {
  body: string;
  uploaded: Date;
  customMetadata?: Record<string, string>;
}

/** An R2 bucket in memory, as far as share uses one. */
class Bucket {
  readonly objects = new Map<string, Stored>();

  add(key: string, body: string, uploaded = new Date(), customMetadata?: Record<string, string>): void {
    this.objects.set(key, { body, uploaded, customMetadata });
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      key,
      body: stored.body,
      httpEtag: `"${key}"`,
      customMetadata: stored.customMetadata,
      uploaded: stored.uploaded,
      writeHttpMetadata: (headers: Headers) => headers.set("content-type", "text/html; charset=utf-8"),
      json: async () => JSON.parse(stored.body),
    };
  }

  async put(key: string, value: string | ArrayBuffer, options?: { customMetadata?: Record<string, string> }) {
    this.add(key, typeof value === "string" ? value : new TextDecoder().decode(value), new Date(), options?.customMetadata);
  }

  async list(options: { prefix?: string; delimiter?: string; cursor?: string }) {
    const prefix = options.prefix ?? "";
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (options.delimiter) {
      const prefixes = new Set<string>();
      const objects = [];
      for (const key of keys) {
        const at = key.indexOf(options.delimiter, prefix.length);
        if (at >= 0) prefixes.add(key.slice(0, at + 1));
        else objects.push({ key, uploaded: this.objects.get(key)!.uploaded });
      }
      return { objects, delimitedPrefixes: [...prefixes], truncated: false };
    }
    return { objects: keys.map((key) => ({ key, uploaded: this.objects.get(key)!.uploaded })), delimitedPrefixes: [], truncated: false };
  }
}

let bucket: Bucket;
let starts: { name: string; job: BuildJob; client: string }[];
let startResult: StartResult;

function request(refs: Record<string, Commit>): ShareRequest {
  const env = { SHARE_PAGES: bucket as unknown as R2Bucket } as unknown as ShareEnv;
  const ShareBuilder = {
    getByName: (name: string) => ({
      start: async (job: BuildJob, client: string) => {
        starts.push({ name, job, client });
        return startResult;
      },
    }),
  } as unknown as ShareRequest["exports"]["ShareBuilder"];
  return {
    env,
    exports: { ShareBuilder },
    client: "203.0.113.7",
    remote: async (url) => ({ ok: true, remote: { url, refs: new Map(Object.entries(refs)) } }),
  };
}

const HEAD_IS_NEW = { HEAD: NEW, "refs/heads/main": NEW };

beforeEach(() => {
  bucket = new Bucket();
  starts = [];
  startResult = { state: "building" };
});

describe("a built page", () => {
  test("HEAD's page is served, cached for a minute, and nothing builds", async () => {
    bucket.add(pageKey(AXO, NEW), "<p>new</p>");
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>new</p>");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("x-feynman-commit")).toBe(NEW);
    expect(starts).toEqual([]);
  });

  test("a commit's page is immutable", async () => {
    bucket.add(pageKey(AXO, OTHER), "<p>other</p>");
    const response = await serve(request(HEAD_IS_NEW), AXO, OTHER);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });
});

describe("HEAD's newest commit is not built", () => {
  test("the page last built for HEAD stands in, uncached, while the new one builds", async () => {
    bucket.add(pageKey(AXO, OLD), "<p>old</p>");
    bucket.add(latestKey(AXO, "HEAD"), JSON.stringify({ key: pageKey(AXO, OLD), commit: OLD }));
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>old</p>");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-feynman-commit")).toBe(OLD);
    expect(starts).toEqual([
      { name: `github.com/leostera/axo@${NEW}`, job: { repository: AXO, cloneUrl: AXO.url, target: NEW, ref: "HEAD" }, client: "203.0.113.7" },
    ]);
  });

  test("with nothing recorded for HEAD, the newest page by any Feynman stands in, and is recorded", async () => {
    bucket.add(`pages/0.14.0/github.com/leostera/axo/${OTHER}.html`, "<p>older</p>", new Date("2026-10-01"));
    bucket.add(`pages/0.15.0/github.com/leostera/axo/${OLD}.html`, "<p>old</p>", new Date("2026-11-11"));
    // A nested repository's page is under the same prefix, and is not this repository's.
    bucket.add(`pages/0.15.0/github.com/leostera/axo/sub/${OTHER}.html`, "<p>nested</p>", new Date("2026-11-17"));
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect(await response.text()).toBe("<p>old</p>");
    expect(JSON.parse(bucket.objects.get(latestKey(AXO, "HEAD"))!.body)).toEqual({ key: `pages/0.15.0/github.com/leostera/axo/${OLD}.html`, commit: OLD });
    expect(starts).toHaveLength(1);
  });

  test("a branch does not stand in for HEAD's records, nor HEAD for a branch", async () => {
    bucket.add(`pages/0.15.0/github.com/leostera/axo/${OLD}.html`, "<p>old</p>");
    const response = await serve(request({ ...HEAD_IS_NEW, "refs/heads/feature": NEW }), AXO, "feature");
    expect(response.status).toBe(202);
    expect(starts[0].job.ref).toBe("feature");
  });

  test("with no earlier page, a page that reloads itself until the build is done", async () => {
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect(response.status).toBe(202);
    expect(response.headers.get("refresh")).toBe("15");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("Building the explorer");
  });

  test("a build that waits for another reloads slowly enough to stay under the build limit", async () => {
    startResult = { state: "busy", retryAfterSeconds: 30 };
    const busy = await serve(request(HEAD_IS_NEW), AXO, null);
    expect({ status: busy.status, refresh: busy.headers.get("refresh") }).toEqual({ status: 202, refresh: "35" });
    startResult = { state: "limited" };
    const limited = await serve(request(HEAD_IS_NEW), AXO, null);
    expect({ status: limited.status, refresh: limited.headers.get("refresh") }).toEqual({ status: 202, refresh: "60" });
  });

  test("when the day's builds are spent, it says so", async () => {
    startResult = { state: "budget", retryAfterSeconds: 3600 };
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect({ status: response.status, retry: response.headers.get("retry-after") }).toEqual({ status: 503, retry: "3600" });
  });
});

describe("a commit asked for by its id", () => {
  test("is never stood in for, and builds with no ref to record", async () => {
    bucket.add(latestKey(AXO, "HEAD"), JSON.stringify({ key: pageKey(AXO, OLD), commit: OLD }));
    bucket.add(pageKey(AXO, OLD), "<p>old</p>");
    const response = await serve(request(HEAD_IS_NEW), AXO, OTHER);
    expect(response.status).toBe(202);
    expect(starts[0].job).toEqual({ repository: AXO, cloneUrl: AXO.url, target: OTHER });
  });
});

describe("a recent failure", () => {
  const failure = (status: number, at: number) => bucket.add(`failures/${FEYNMAN_VERSION}/github.com/leostera/axo/${NEW}.json`, JSON.stringify({ status, message: "feynman build failed", log: "the log" }), new Date(at), { failedAt: String(at) });

  test("shows HEAD's previous page, and does not build again", async () => {
    failure(422, Date.now());
    bucket.add(pageKey(AXO, OLD), "<p>old</p>");
    bucket.add(latestKey(AXO, "HEAD"), JSON.stringify({ key: pageKey(AXO, OLD), commit: OLD }));
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect(await response.text()).toBe("<p>old</p>");
    expect(starts).toEqual([]);
  });

  test("with no previous page, shows the failure and its log", async () => {
    failure(422, Date.now());
    const response = await serve(request(HEAD_IS_NEW), AXO, null);
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("the log");
    expect(starts).toEqual([]);
  });

  test("of the sandbox stands for five minutes, of the specs for an hour", async () => {
    failure(500, Date.now() - 6 * 60 * 1_000);
    await serve(request(HEAD_IS_NEW), AXO, null);
    expect(starts).toHaveLength(1);
    starts = [];
    failure(422, Date.now() - 6 * 60 * 1_000);
    await serve(request(HEAD_IS_NEW), AXO, null);
    expect(starts).toEqual([]);
  });
});

describe("latestKey", () => {
  test("a repository a/b with ref c/d is not a/b/c with ref d", () => {
    expect(latestKey(repository("gitlab.com/a/b"), "c/d")).not.toBe(latestKey(repository("gitlab.com/a/b/c"), "d"));
    expect(latestKey(AXO, "HEAD")).toBe("latest/github.com/leostera/axo/HEAD.json");
  });
});
