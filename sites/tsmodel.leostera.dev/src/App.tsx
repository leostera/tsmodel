import { ArrowRightIcon, CheckIcon, CopyIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import install from "../snippets/install.sh?highlight";
import payments from "../snippets/payments.ts?highlight";
import paymentsCheck from "../snippets/payments-check.txt?highlight";
import faultsSnippet from "../snippets/faults.ts?highlight";
import faultsCheck from "../snippets/faults-check.txt?highlight";
import prompt from "../snippets/prompt.txt?highlight";
import rules from "../snippets/rules.ts?highlight";
import rulesCheck from "../snippets/rules-check.txt?highlight";
import conformSnippet from "../snippets/conform.ts?highlight";
import conformCheck from "../snippets/conform-check.txt?highlight";

type Showcase = {
  id: string;
  moment: string;
  example: string;
  text: string;
  image: string;
  alt: string;
  /** The repository whose explorer it opens (`<host>/<path>`, served under /s/), and where in it. */
  repository: string;
  at?: string;
};

/** The three moments to reach for tsmodel, each shown on a real playground. */
const SHOWCASES: Showcase[] = [
  {
    id: "design",
    moment: "Design a system",
    example: "Two-phase commit",
    text: "Settle the design with your agent before it writes the code.",
    image: "two-phase-commit",
    alt: "Playground of a two-phase commit: a coordinator and two participants that have committed",
    repository: "github.com/leostera/tsmodel",
    at: `#/playground/two-phase-commit/${encodeURIComponent("Everyone votes yes")}`,
  },
  {
    id: "understand",
    moment: "Understand a system",
    example: "Remote access",
    text: "Model how existing code behaves, and find the constraints it relies on.",
    image: "axo-sim",
    alt: "Playground of remote access: people, Macs, Cloudflare Access and a relay",
    repository: "github.com/leostera/axo",
  },
  {
    id: "change",
    moment: "Check a change",
    example: "Payments",
    text: "See what a change does to every flow. Here, a retry charges twice.",
    image: "payments",
    alt: "Playground of payments: the bank debits the same payment twice and the property is broken",
    repository: "github.com/leostera/tsmodel",
    at: `#/playground/payments/${encodeURIComponent("The retry fires first")}`,
  },
];

/** An example spec in tsmodel's own explorer, opened at the scenario that shows the bug. */
type Example = { spec: string; scenario: string; name: string };

const EXAMPLES = "/s/github.com/leostera/tsmodel/";
const exampleHref = (e: Example) => `${EXAMPLES}#/playground/${e.spec}/${encodeURIComponent(e.scenario)}`;

/** The kinds of bug a design hides, each in examples that open on the trace that shows it. */
const BUGS: { title: string; text: string; examples: Example[] }[] = [
  {
    title: "A retry does it twice",
    text: "The bank's answer is lost, the client's call fails, it retries, and the bank charges again. Or the retry timer fires before the answer arrives, with nothing lost at all.",
    examples: [
      { spec: "retried-call", scenario: "The answer is lost", name: "Retried call" },
      { spec: "payments", scenario: "The retry fires first", name: "Payments" },
    ],
  },
  {
    title: "A restart forgets",
    text: "A node votes, restarts with its vote only in memory, and votes again in the same term: two leaders. An order is stored, and its announcement dies with the process.",
    examples: [
      { spec: "raft-vote", scenario: "A voter restarts", name: "Raft vote" },
      { spec: "outbox", scenario: "The shop restarts after storing", name: "Outbox" },
    ],
  },
  {
    title: "A late message wins",
    text: "A lock holder stalls past its lease and wakes up, and its write lands after the next holder's. A slow cache fill overtakes the invalidation that should have replaced it.",
    examples: [
      { spec: "lease-lock", scenario: "A stalled holder wakes up", name: "Lease lock" },
      { spec: "cache", scenario: "A stale fill overtakes the invalidation", name: "Cache" },
    ],
  },
  {
    title: "Check, then act",
    text: "Two doctors each see the other on call, and both go home. Two withdrawals read the same balance, and one is never taken off.",
    examples: [
      { spec: "write-skew", scenario: "Both at once", name: "Write skew" },
      { spec: "lost-update", scenario: "Both read before either writes", name: "Lost update" },
    ],
  },
  {
    title: "Reads go back in time",
    text: "A client reads from the head of a chain, then from the tail, and sees an older value the second time. A read from one replica misses a write that finished.",
    examples: [
      { spec: "chain-replication", scenario: "Reading from both ends", name: "Chain replication" },
      { spec: "quorum", scenario: "A read misses the write", name: "Quorum" },
    ],
  },
  {
    title: "Replicas never agree",
    text: "Two writes get the same timestamp, the replicas keep them in different orders, and no amount of waiting brings them back together.",
    examples: [{ spec: "lww-register", scenario: "Two writes at the same time", name: "Last-writer-wins" }],
  },
  {
    title: "Two of the one thing",
    text: "A resent token crosses its slow first copy, and two nodes hold the one token. Two nodes ask at the same moment, and each lets the other in.",
    examples: [
      { spec: "token-ring", scenario: "A resend crosses the first copy", name: "Token ring" },
      { spec: "ricart-agrawala", scenario: "Both ask at once", name: "Ricart–Agrawala" },
    ],
  },
  {
    title: "Waiting forever",
    text: "A vote is lost and the coordinator never decides. Two philosophers each hold one fork and wait for the other. The checker says who waits, and for what.",
    examples: [
      { spec: "two-phase-commit", scenario: "A vote is lost", name: "Two-phase commit" },
      { spec: "dining-philosophers", scenario: "Both get hungry", name: "Dining philosophers" },
    ],
  },
];

/** Bugs found while designing real systems with tsmodel, before their code was written. */
const FOUND = [
  "Two quick sign-ins, then a refresh: the service refused the old grant's refresh, and the handler deleted the newer grant.",
  "A shard split whose activation message was lost: listings asked the new shard, forever, to serve.",
  "A partial message that held one of a receiver's four slots forever, once its sender gave up on it.",
  "Text edited after it was approved for saving: it was stored without passing the content screen again.",
];

const VERDICTS: { sign: string; name: string; text: string; tone: string }[] = [
  { sign: "✗", name: "Broken", text: "A scenario, search, or random walk found a trace that breaks the property. For what must be possible, every state was explored and none gets there.", tone: "broken" },
  { sign: "✓", name: "Holds", text: "The search explored every state the spec can reach and found no violation. Or, for what must be possible, it found the shortest way there.", tone: "holds" },
  { sign: "~", name: "Held so far", text: "A limit or a depth bound stopped the search first. It says how far it got (\u201cheld on every path of up to 9 events\u201d) and what to make smaller.", tone: "held" },
  { sign: "?", name: "Not tested", text: "The explored states never reached a case where this property could be judged.", tone: "untested" },
];

/** The payments counterexample `check` prints (snippets/payments-check.txt), step by step. */
const TRACE: { actor: "Client" | "Bank"; step: string; from?: string; says: string; breaks?: string }[] = [
  { actor: "Client", step: "pay", says: "Pays, and sends the bank a debit for payment-1." },
  { actor: "Bank", step: "debit", from: "Client", says: "Debits the account." },
  { actor: "Client", step: "retry", says: "No answer yet: pays again." },
  { actor: "Bank", step: "debit", from: "Client", says: "Debits the account again.", breaks: "breaks debitedOnce" },
];

const GITHUB = "https://github.com/leostera/tsmodel";

/** The wordmark's mark: two actors and the message between them. */
function Mark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="24" r="6" />
      <circle cx="38" cy="24" r="6" />
      <path d="M18 24h12m-5-5 5 5-5 5" />
    </svg>
  );
}

export function App() {
  return (
    <div className="wrap">
      <header className="top">
        <a href="/" className="brand" aria-label="tsmodel">
          <Mark />
          <b>tsmodel</b>
        </a>
        <nav aria-label="Site">
          <a className="section-link" href="#bugs">
            What it finds
          </a>
          <a className="section-link" href="#model">
            How it works
          </a>
          <a className="section-link" href="#production">
            In production
          </a>
          <a href="#agents">Onboard your agent</a>
          <a className="icon" href={GITHUB} aria-label="tsmodel on GitHub" title="tsmodel on GitHub">
            <GithubLogoIcon size={20} weight="bold" />
          </a>
        </nav>
      </header>

      <main>
        <section className="hero split middle">
          <div>
            <h1>Find design bugs before your code does.</h1>
            <p className="lede">
              Model how your system behaves once. Explore it in a playground, and check it for <mark>the orderings and failures</mark> that break it.
            </p>
            <div className="acts">
              <a className="button" href="#agents">
                Onboard your agent
              </a>
              <a className="more" href="#playground">
                Open a playground <ArrowRightIcon size={16} weight="bold" />
              </a>
            </div>
          </div>
          <Trace />
        </section>

        <Section id="playground" title="See the design move" lead="Every spec is a playground: step the actors by hand, lose a message, crash a process, and watch what each one knows. These three are real specs, open in the explorer.">
          <Showcases />
        </Section>

        <Section
          id="bugs"
          title="The bugs designs hide"
          lead="Not typos or types: orderings. A message lost, late, or delivered twice; a restart in the middle; two people at once. Each example is a spec you can open, on the shortest trace that breaks it."
        >
          <ul className="quarters bugs">
            {BUGS.map((bug) => (
              <li key={bug.title}>
                <h3>{bug.title}</h3>
                <p>{bug.text}</p>
                <p className="links">
                  {bug.examples.map((e) => (
                    <a key={e.spec} className="more" href={exampleHref(e)}>
                      {e.name} <ArrowRightIcon size={13} weight="bold" />
                    </a>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <div className="found split">
            <h3>Found in real designs, before the code</h3>
            <ul>
              {FOUND.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="model" title="One model. Explore it and check it." lead="A spec is a TypeScript file: actors, messages, the faults they meet, and the properties that must hold. The same file runs the playground and the checker.">
          <Pair left={<Code snippet={payments} label="specs/payments.ts" />} right={<Code snippet={paymentsCheck} label="bunx tsmodel check" />} caption="The checker finds the shortest order of events in which a retry charges twice." />
        </Section>

        <Section
          id="faults"
          title="Say how your system fails"
          lead="Faults are steps the spec declares, where they happen: a message lost on the way, delivered twice, a process that crashes and keeps only what is on disk, a call that throws. A budget bounds how many happen on one path. Declare the failures your system really meets, and nothing else; a fault the library lacks is a step you write."
        >
          <Pair left={<Code snippet={faultsSnippet} label="specs/retried-call.ts" />} right={<Code snippet={faultsCheck} label="bunx tsmodel check" />} caption="Every counterexample says how many faults it needs. With none, the retry holds; one lost answer, and it charges twice." />
        </Section>

        <Section id="checker" title="Know how far a check went" lead="Every property gets a verdict that says what the search covered, so a pass never claims more than the checker saw.">
          <ul className="verdicts">
            {VERDICTS.map(({ sign, name, text, tone }) => (
              <li key={name}>
                <span className={`sign ${tone}`} aria-hidden="true">
                  {sign}
                </span>
                <p>
                  <b>{name}.</b> {text}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="rules"
          title="Know which parts of the design matter"
          lead="Name the rules a design relies on, and say which properties need them. The checker also checks the design without each rule, and fails if nothing breaks: the rule does nothing, or the property is too weak to see what it prevents."
        >
          <Pair left={<Code snippet={rules} label="specs/retried-call.ts" />} right={<Code snippet={rulesCheck} label="bunx tsmodel check" />} caption="Without the idempotency key, a lost answer and a retry charge the customer twice." />
        </Section>

        <Section
          id="production"
          title="Hold the model up to production"
          lead="A check asks whether everything the spec allows is safe. A trace asks the other question: does the spec allow what the system did? Give tsmodel conform an OpenTelemetry, Jaeger or Zipkin trace, and it finds the run of the spec the trace is, judging every property along it, or the span where the system did something the spec says can't happen."
        >
          <Pair
            left={<Code snippet={conformSnippet} label="trace-map.ts" />}
            right={<Code snippet={conformCheck} label="bunx tsmodel conform" />}
            caption="The spec has the box office claim the seat in a second step, and the trace never shows one: the code holds it in one statement. Clocks across machines are not trusted; only each service's order, and what caused what."
          />
        </Section>

        <section id="agents" className="section closing split">
          <div>
            <h2>Onboard your agent</h2>
            <p className="lead">Give your agent the tsmodel skill and one behavior to model. It reads the code, writes the spec, runs the checks, and reports what it found.</p>
            <p className="caption">Pi loads the skill from the package. Other agents read it from this site; the prompt beside it is a good start.</p>
            <div className="acts">
              <a className="button" href="/SKILL.md">
                Open the tsmodel skill
              </a>
              <a className="button quiet" href={GITHUB}>
                <GithubLogoIcon size={18} weight="bold" /> Source on GitHub
              </a>
            </div>
          </div>
          <div className="stack">
            <Code snippet={prompt} label="A prompt to start with" prose />
            <Code snippet={install} label="Or by hand" />
          </div>
        </section>
      </main>

      <footer>
        <span>tsmodel is open source, by Leandro Ostera.</span>
        <nav aria-label="More">
          <a href="/llms.txt">llms.txt</a>
          <a href="/SKILL.md">SKILL.md</a>
          <a href={`${GITHUB}/blob/main/packages/tsmodel/CHANGELOG.md`}>Changelog</a>
          <a href={GITHUB}>GitHub</a>
        </nav>
      </footer>
    </div>
  );
}

/** A section: its title in the left half, what it is about in the right, then its content. */
function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={id} className="section">
      <div className="split intro">
        <h2>{title}</h2>
        <p className="lead">{lead}</p>
      </div>
      {children}
    </section>
  );
}

/** A spec and what the CLI says about it, one in each half; the output stays in view beside a long spec. */
function Pair({ left, right, caption }: { left: ReactNode; right: ReactNode; caption: string }) {
  return (
    <div className="split">
      {left}
      <div className="sticky">
        {right}
        <p className="caption">{caption}</p>
      </div>
    </div>
  );
}

/**
 * The payments counterexample, step by step: who did what, each actor's state, and the moment
 * the property breaks. Rendered whole, so the page shows it without JavaScript; it replays while
 * on screen, and stays still for reduced motion.
 */
function Trace() {
  const [shown, setShown] = useState(TRACE.length);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    let at = TRACE.length;
    const observer = new IntersectionObserver(([entry]) => void (visible = entry!.isIntersecting));
    observer.observe(ref.current!);
    // Each step 1.4 s after the one before; the broken end stays 4.2 s; then from the start.
    let wait = 3;
    const timer = setInterval(() => {
      if (!visible || document.hidden) return;
      if (--wait > 0) return;
      at = at >= TRACE.length ? 0 : at + 1;
      wait = at === TRACE.length ? 3 : 1;
      setShown(at);
    }, 1400);
    return () => (clearInterval(timer), observer.disconnect());
  }, []);
  const done = TRACE.slice(0, shown);
  const paid = done.filter((s) => s.actor === "Client").length;
  const debits = done.filter((s) => s.actor === "Bank").length;
  const broken = shown === TRACE.length;
  return (
    <figure className="trace" ref={ref} aria-label="A counterexample from tsmodel check: the client pays, the bank debits, the client retries, and the bank debits again, which breaks debitedOnce">
      <div className="actors" aria-hidden="true">
        <div className="actor">
          <b>Client</b>
          <span>
            paid: <em>{paid}</em>
          </span>
        </div>
        <div className="actor">
          <b>Bank</b>
          <span>
            debits: <em>{debits}</em>
          </span>
        </div>
        <span className={`verdict${broken ? " broken" : ""}`}>{broken ? "✗ debitedOnce" : "~ debitedOnce"}</span>
      </div>
      <ol>
        {TRACE.map((s, i) => (
          <li key={i} className={i < shown ? "" : "later"}>
            <span className="n">{i + 1}</span>
            <p className="head">
              <b>{s.actor}</b>
              <span>
                {s.step}
                {s.from ? ` from ${s.from}` : ""}
              </span>
            </p>
            <p className="says">{s.says}</p>
            {s.breaks ? <p className="breaks">✗ {s.breaks}</p> : null}
          </li>
        ))}
      </ol>
      <figcaption>tsmodel check · the shortest counterexample</figcaption>
    </figure>
  );
}

/** Three moments to reach for tsmodel, each on a real playground, switched by tabs. */
function Showcases() {
  const [current, setCurrent] = useState(SHOWCASES[1]!.id);
  const shown = SHOWCASES.find((item) => item.id === current) ?? SHOWCASES[1]!;
  const href = `/s/${shown.repository}/${shown.at ?? ""}`;
  return (
    <div>
      <div role="tablist" aria-label="When to use tsmodel" className="moments">
        {SHOWCASES.map((item) => (
          <button key={item.id} id={`tab-${item.id}`} role="tab" type="button" aria-selected={item.id === current} aria-controls="showcase" onClick={() => setCurrent(item.id)}>
            {item.moment} <span>· {item.example}</span>
          </button>
        ))}
      </div>
      <div id="showcase" role="tabpanel" aria-labelledby={`tab-${shown.id}`}>
        <a className="shot" href={href}>
          <picture>
            <source srcSet={`/${shown.image}-dark.jpg`} media="(prefers-color-scheme: dark)" />
            <img src={`/${shown.image}-light.jpg`} alt={shown.alt} width={1500} height={900} />
          </picture>
          <span className="open button">
            Explore playground <ArrowRightIcon size={16} weight="bold" />
          </span>
        </a>
        <div className="shot-foot">
          <p>{shown.text}</p>
          <a className="more" href={href}>
            Explore playground <ArrowRightIcon size={14} weight="bold" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** A highlighted snippet (from scripts/highlight.ts) with what it is and a copy button. */
function Code({ snippet, label, prose = false }: { snippet: { code: string; html: string }; label: string; prose?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(snippet.code).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));
  return (
    <figure className={prose ? "code prose" : "code"}>
      <figcaption>
        <span>{label}</span>
        <button type="button" className="copy" onClick={copy}>
          {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} weight="bold" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <div className="body" dangerouslySetInnerHTML={{ __html: snippet.html }} />
    </figure>
  );
}
