# tsmodel

**Find design bugs before your code does.**

The bugs that reach production are rarely typos. They're orderings: a reply that's lost, a
retry that lands twice, a lease that runs out mid-write, two people pressing the same button.
Tests miss them because nobody thought to write that order down, and reading the code doesn't
show them either.

With tsmodel you write down how a system behaves, once, in TypeScript: who the actors are, the
messages between them, the failures they meet, and what must always hold. tsmodel then tries
every order of events for you, and when something breaks, it shows you the shortest story of
how:

```
$ bunx tsmodel check
specs/payments.ts
Payments: explored 55 states (1 of each actor, faults=1) in 8ms
  ✗ debitedOnce  The bank debits once per payment.
    shortest counterexample, 4 event(s), needs no faults:
       1  Client (Client)  pay
          Pays, retrying until the bank answers.
          paid: 0 → 1
          pending: "" → "payment-1"
          → Bank: debit {"id":"payment-1"}
          ⏱ retry set
       2  Bank (Bank)  debit  {"id":"payment-1"}  from Client
          Debits the account.
          debits: 0 → 1
       3  Client (Client)  retry
          No answer yet: pays again.
          → Bank: debit {"id":"payment-1"}
       4  Bank (Bank)  debit  {"id":"payment-1"}  from Client
          Debits the account.
          debits: 1 → 2
          ✗ breaks debitedOnce
```

See it on a real system: [axo's remote access](https://tsmodel.leostera.dev/s/github.com/leostera/axo/),
where people pair Macs with a one-time code and open terminals on them through a relay.

## What you get

- **Answers before the code exists.** Settle a design with your team, or your coding agent,
  while changing it is still cheap. Bugs like a refresh that deleted the newer grant, or a
  shard split that left listings waiting forever, were found this way before their code was
  written.
- **A playground for every design.** Add people and machines, press the buttons they would,
  watch every message travel, lose one, crash a process, and go back to any moment to try
  something else. Share it as one HTML file, or as a link to any public repository.
- **A checker that says how sure it is.** Every rule gets one of four verdicts, and tsmodel
  never rounds up: `✗` broken, with the trace; `✓` holds, with every state explored; `~` held
  as far as the search got; `?` never tested. Its answers match TLA+'s TLC and the P checker
  on the examples.
- **Your real failures, and nothing else.** Declare the faults your system actually meets:
  lost or duplicated messages, crashes that keep only what's on disk, calls that throw.
- **Rules that earn their keep.** Name the rules a design relies on, and tsmodel checks the
  design without each one. If nothing breaks, the rule does nothing, or the property is too
  weak to see what it prevents.
- **The model held up to production.** Give `tsmodel conform` an OpenTelemetry, Jaeger or
  Zipkin trace, and it tells you whether the system did something the design says can't
  happen, and on which span.
- **Specs that keep up with the code.** Each step points at the code it stands for, and
  tsmodel warns you when that code changes under the spec. `tsmodel diff` shows what a change
  does to every flow.

## Start

tsmodel runs on [Bun](https://bun.sh) 1.3 or later.

```sh
bun add -d @tsmodel/tsmodel
bunx tsmodel check    # try every order of events, and judge every rule
bunx tsmodel dev      # the playground, reloading as the spec changes
bunx tsmodel build    # the playground as one self-contained HTML file
```

To learn to write specs, read *[Writing specs with tsmodel](https://github.com/leostera/tsmodel/blob/main/book/README.md)*,
a book that builds every spec step by step, from a first race condition to two-phase commit.
The [examples](https://github.com/leostera/tsmodel/tree/main/packages/tsmodel/examples)
are well-known systems (two-phase commit, Raft's vote, chain replication, CRDTs, dining
philosophers and more), each with a real bug for the checker to find and the fix beside it.

## Let your agent write it

Specs are meant to be written by coding agents and read by people. tsmodel ships a skill that
teaches an agent to read a codebase, model one behaviour, check it, and report what it found.
Pi loads it from the package, and any other agent can read it at
https://tsmodel.leostera.dev/SKILL.md. A prompt to start from:

> Read https://tsmodel.leostera.dev/SKILL.md, then write a tsmodel spec for how <the behaviour>
> works in this repository. Put it in specs/, and run `bunx tsmodel check` until every rule
> holds or you can show a real bug. Report what the spec covers and every verdict.

## More

- [tsmodel.leostera.dev](https://tsmodel.leostera.dev): what tsmodel finds, with playgrounds
  you can open.
- [Changelog](https://github.com/leostera/tsmodel/blob/main/packages/tsmodel/CHANGELOG.md):
  what changed in each release, and how to migrate.
- [Contributing](https://github.com/leostera/tsmodel/blob/main/CONTRIBUTING.md): how the
  repository is laid out, and how to build, test and release it.

tsmodel is early: the DSL may still change between minor versions, and each change comes with
migration notes.
