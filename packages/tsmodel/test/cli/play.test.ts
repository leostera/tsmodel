import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleBrowser } from "../../src/cli/bundle-browser.ts";
import { loadPlayground } from "../../src/cli/load.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "tsmodel-play-"));
  mkdirSync(join(dir, "specs"));
  writeFileSync(
    join(dir, "specs", "tiny.ts"),
    `import { defineActor, defineSpec, defineZone } from "@tsmodel/tsmodel";
const zone = defineZone({ name: "z" });
export const Lamp = defineActor({ name: "Lamp", zone, initialState: () => ({ on: false }), actions: { flip: { label: "Flip", description: "Flips it.", run: (s) => void (s.on = !s.on) } } });
export default defineSpec({ name: "Tiny", actors: [Lamp] });`,
  );
  writeFileSync(
    join(dir, "specs", "tiny.play.tsx"),
    `import { definePlayground, Node } from "@tsmodel/tsmodel/play";
import { useState } from "react";
import spec, { Lamp } from "./tiny.ts";
export default definePlayground(spec, (play) => {
  play.actor(Lamp, { node: ({ state }) => <Node shape="circle" icon="bell" label={state.on ? "on" : "off"} /> });
});
export const unused = useState;`,
  );
  return join(dir, "specs", "tiny.play.tsx");
}

test("a playground bundle for the browser uses the page's React, Kumo and kit", async () => {
  const code = await bundleBrowser(fixture());
  expect(code).toContain("globalThis.__tsmodel.modules");
  expect(code).not.toContain("react.production");
  expect(code).toContain('"Lamp"');
});

test("loading a playground checks it names the spec's actors", async () => {
  const play = (await loadPlayground(fixture())) as { kind: string; actor: Record<string, unknown> };
  expect(play.kind).toBe("tsmodel.playground");
  expect(Object.keys(play.actor)).toEqual(["Lamp"]);
});
