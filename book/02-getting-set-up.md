# 2. Getting set up

tsmodel is a TypeScript library and a command-line tool, in one npm package. It runs on
[Bun](https://bun.sh), 1.3 or later.

## Installing

In the repository whose behaviour you want to model:

```sh
bun add -d @tsmodel/tsmodel
```

That gives you two things:

- the DSL, which specs import as `@tsmodel/tsmodel`, with its types for your editor;
- the `tsmodel` command, which you run as `bunx tsmodel`.

To try it without installing anything, `bunx @tsmodel/tsmodel check` works too. The CLI
resolves `@tsmodel/tsmodel` in your specs to itself.

If your editor complains about imports ending in `.ts`, your `tsconfig.json` needs what
Bun's default has:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true
  }
}
```

## Where specs live

tsmodel looks for specs in `specs/*.ts`, next to any `package.json`, and the repository root
counts. A repository with a web app and an API might look like this:

```text
my-repo/
├── package.json
├── specs/
│   ├── checkout.ts
│   └── sign-in.ts
├── apps/web/…
└── services/api/…
```

Each spec file exports one spec by default:

```ts
export default defineSpec({ name: "Checkout", actors: [/* … */] });
```

To keep specs somewhere else, add a `tsmodel.config.ts` at the repository root:

```ts
import { defineConfig } from "@tsmodel/tsmodel/config";

export default defineConfig({
  specs: ["docs/specs/*.ts"],
  check: { maxStates: 500_000 },
});
```

`check` sets the checker's defaults for every run. Flags on the command line override them.

Spec names on the command line are file names without `.ts` (`tsmodel check checkout`), or
paths (`tsmodel check specs/checkout.ts`). This book's specs live under `book/specs/`, one
directory per chapter and one file per step, so the commands in the text use paths.

## The commands

You will use five of them all the time.

| Command | What it does |
| --- | --- |
| `tsmodel list` | Lists the specs it finds, with how many actors, messages, properties and scenarios each has. |
| `tsmodel check [spec]` | Type-checks the spec, runs every scenario, explores every order of events within bounds, and judges every property. Exits non-zero if anything is wrong. |
| `tsmodel run [spec]` | Runs the scenarios and prints their traces as text. `--scenario NAME` picks one, and `--all` prints every trace. |
| `tsmodel dev` | Opens the simulator in the browser, and reloads it as you edit the spec. |
| `tsmodel build` | Writes the simulator as one self-contained HTML file, to host or share. |

Three more matter once a spec points at real code. Part II covers them:

| Command | What it does |
| --- | --- |
| `tsmodel lock` | Records what the code each step points at looks like, in `tsmodel.lock`. |
| `tsmodel diff --base main` | Shows how each scenario's flow changed since another commit. |
| `tsmodel open` | Opens the last build. |

## Your first check

Make `specs/hello.ts`:

```ts
import { defineActor, defineProperty, defineSpec, defineZone } from "@tsmodel/tsmodel";

const room = defineZone({ name: "Room" });

const Lamp = defineActor({
  name: "Lamp",
  zone: room,
  singleton: true,
  initialState: () => ({ on: false }),
  transitions: {
    switchOn: { description: "Someone switches it on.", when: (s) => !s.on, run: (s) => void (s.on = true) },
    switchOff: { description: "Someone switches it off.", when: (s) => s.on, run: (s) => void (s.on = false) },
  },
});

const neverOn = defineProperty("neverOn", {
  description: "The lamp is never on.",
  always: (w) => !w.the(Lamp).state.on,
});

export default defineSpec({ name: "Hello", actors: [Lamp], properties: [neverOn] });
```

The steps here are on no message. Each has a `when` guard and can run whenever its guard
holds. The property is wrong on purpose:

```sh
bunx tsmodel check hello
```

```text
specs/hello.ts
Hello: explored 2 states (1 of each actor) in 18ms
  ✗ neverOn  The lamp is never on.
    shortest counterexample, 1 event(s), needs no faults:
       1  Lamp (Lamp)  switchOn
          Someone switches it on.
          on: false → true
          ✗ breaks neverOn
```

That is the whole loop: a model, a property, a verdict, and the shortest way to break it.
Change the property to something true, `always: (w) => typeof w.the(Lamp).state.on === "boolean"`,
and it says `✓`.

Now run `bunx tsmodel dev`. The browser shows a room with a lamp in it. Press Step (→): the
lamp goes on. Step again: it goes off. Steps with a `when` guard run whenever the system is
left alone and their guard holds. The timeline on the side records each event, and ← takes
you back one event at a time, to try something else from there.

## Reading check's output

`tsmodel check` prints a lot, on purpose. These flags pick out what you need:

- `--brief`: one line per property. Start here when several fail.
- `--only P`: only property `P`, with its counterexample in full.
- `--as-scenario`, with `--only P`: the counterexample as scenario code you can paste into the
  spec (chapter 6).
- `--json`: everything, for scripts and agents.

Every property gets one of four verdicts, and tsmodel never rounds up:

| Verdict | Meaning |
| --- | --- |
| `✓` | Holds in every state within the bounds, and every state was explored. |
| `~` | Held in the states explored, but a limit stopped the search first. Not a proof. |
| `?` | Never tested: no world the checker reached was one the property is about. |
| `✗` | Broken, with the trace that breaks it. |

We will meet each of them in Part I.

## Following along

This book's specs are in the tsmodel repository, under
[`book/specs`](https://github.com/leostera/tsmodel/tree/main/book/specs). From a clone:

```sh
bun install
bun run tsmodel check book/specs/01-wire/1-overdraft.ts --instances Wire=2
```

Every spec in the book is checked by the repository's tests, so the output you see in the
text is what the checker says today.
