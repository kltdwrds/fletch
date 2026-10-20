// M19.2: one job per request, and a guessed time said in code (QYVR-171 steps 5 and 6, QYVR-162,
// QYVR-165). The scripted fake model drives the real chat engine, gate, cards, `Person` authority and
// `Job` engine on the world's clock. Ada and Bo of solo-sam wherever a job is read: Bo never sees,
// matches or reuses Ada's job.
import { describe, expect, it } from "vitest";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { appRoutes } from "../../packages/agent/src/http/app-routes.ts";
import { JOB_STATUS_WORDS, statusWords } from "../../packages/agent/src/jobs/status-words.ts";
import type { JobStatus } from "../../packages/agent/src/jobs/store.ts";
import { type FakeStep, report } from "../support/fake-model.ts";
import { jobIdFor } from "../../packages/agent/src/jobs/tools.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const TITLE = "Stretch reminder";
const BODY = "Remind me to stretch.";
const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
const create = (schedule: unknown, extra: Record<string, unknown> = {}, id = "c1", title = TITLE): FakeStep => ({
  toolCall: { id, name: "jobs_create", arguments: { title, instructions: BODY, schedule, ...extra } },
});
const enable = (jobId: string, id = "e1"): FakeStep => ({ toolCall: { id, name: "jobs_enable", arguments: { id: jobId } } });
const open = async (w: ReturnType<typeof authorityWorld>, p: string) => ((await w.host(p).chats.open(w.clock.now)) as { chatId: string }).chatId;

describe("[M19.2] two identical relative requests give one job (QYVR-162)", () => {
  it("'in 2 minutes' asked again while the first is pending resolves to another time and is still the first job", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 2 }), { text: "Set." });
    await w.say(ada.email, "In 2 minutes, remind me to stretch.", chat);
    const [first] = w.jobIds(ada.email);
    w.clock.now += 90_000;
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 2 }, {}, "c2"), { text: "Same one." });
    await w.say(ada.email, "In 2 minutes, remind me to stretch.", chat);
    expect(w.jobIds(ada.email)).toEqual([first]);
    expect(w.transcriptOf(ada.email).join("\n")).toContain(`The job ${first} (${TITLE}) already existed (off until you turn it on`);
  });

  it("a pending job is reused whatever time the repeat resolves to, an active one stays active", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: "2026-10-13T10:10" }, BODY);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 10 }), enable(id), { text: "It is on." });
    await w.say(ada.email, "In 10 minutes, remind me to stretch, and turn it on.", chat);
    await w.chats.harness(chat).instance.decide([w.cardsOf(ada.email)[0]!.id], { person: ada.email, agent: false }, "once");
    w.clock.now += 60_000;
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 10 }, {}, "c2"), { text: "On already." });
    await w.say(ada.email, "In 10 minutes, remind me to stretch.", chat);
    expect(w.jobIds(ada.email)).toEqual([id]);
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "active" });
    expect(w.transcriptOf(ada.email).join("\n")).toContain("already existed (on");
  });

  it("a one-shot that has fired is not reused: the repeat is a second job and the answer says the earlier one already ran", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const first = jobIdFor(TITLE, chat, { kind: "runonce", at: "2026-10-13T10:03" }, BODY);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 3 }), enable(first), { text: "It is on." });
    await w.say(ada.email, "In 3 minutes, remind me to stretch.", chat);
    await w.chats.harness(chat).instance.decide([w.cardsOf(ada.email)[0]!.id], { person: ada.email, agent: false }, "once");
    w.fake.enqueue(report("Stretch now."));
    await w.fireJob(ada.email, first);
    expect(w.jobOf(ada.email, first).instance.status()).toMatchObject({ status: "finished" });

    w.fake.enqueue(create({ kind: "runonce", in_minutes: 3 }, {}, "c2"), { text: "Made another." });
    await w.say(ada.email, "In 3 minutes, remind me to stretch.", chat);
    const ids = w.jobIds(ada.email);
    expect(ids).toHaveLength(2);
    const text = w.transcriptOf(ada.email).join("\n");
    expect(text).not.toContain("already existed");
    expect(text).toContain(`The earlier job ${first} (${TITLE}) already ran and is finished; this creates another`);
    expect(w.jobOf(ada.email, ids.find((i) => i !== first) as string).instance.status()).toMatchObject({ status: "needs_enable" });
  });
});

describe("[M19.2] the job's time is said in code (QYVR-165; every job since M21.1)", () => {
  const AT = "2026-10-14T09:00";
  const WHEN = "once, at 2026-10-14 09:00 (Europe/London)";
  const LINE = "Set for Wednesday 2026-10-14 at 09:00 Europe/London. Say so to change it.";
  const picked = (id = "c1"): FakeStep => create({ kind: "runonce", at: AT }, { zone: "Europe/London" }, id, "Dentist reminder");

  const sentIn = (w: ReturnType<typeof authorityWorld>, chat: string) => w.chats.harness(chat).rows("SELECT payload FROM outbox").map((r) => JSON.parse(String(r.payload)) as { kind: string; text?: string }).filter((e) => e.kind === "deliver").map((e) => String(e.text));

  it("a turn that pauses on the card with no model text still delivers the picked time and the offer to change it", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const socket = w.chats.harness(chat).connect();
    const id = jobIdFor("Dentist reminder", chat, { kind: "runonce", at: AT }, BODY);
    // The model's last step is the enable proposal and it writes no words of its own.
    w.fake.enqueue(load, picked(), enable(id));
    const said = await w.say(ada.email, "Remind me sometime tomorrow to book the dentist.", chat);
    expect(said.result).toMatchObject({ status: "done", awaiting: true });
    const sentence = LINE;
    expect(sentIn(w, chat)).toEqual([sentence]);
    expect(socket.frames.filter((f) => f.type === "message").map((f) => f.text)).toEqual([sentence]);
    // The card carries the same time.
    expect(w.cardsOf(ada.email)[0]?.lines).toEqual(expect.arrayContaining([`When: ${WHEN}`]));
  });

  it("a time the person named is delivered the same way (M21.1: no flag decides it)", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", at: AT }, { zone: "Europe/London" }, "c1", "Dentist reminder"), { text: "Set for 09:00." });
    await w.say(ada.email, "Remind me tomorrow at 9 to book the dentist.", chat);
    expect(sentIn(w, chat)).toEqual([LINE]);
  });
});

describe("[M19.2] the job tools and the Jobs page say a status in the same words", () => {
  const STATUSES = Object.keys(JOB_STATUS_WORDS) as JobStatus[];

  // From M20.1 the Jobs route sends each job's words from the table and the page draws them: the route is
  // asked for a job in every status, and the job dialog's chip and its row's line (M27.4) are lifted from the
  // page's script and run.
  const lift = (re: RegExp, what: string): ((job: Record<string, unknown>) => string) => {
    const m = re.exec(APP_PAGE);
    if (!m) throw new Error(`the job's ${what} is no longer built where this test reads it`);
    return new Function("job", `return ${m[1]};`) as (job: Record<string, unknown>) => string;
  };
  const chip = lift(/\$\("job-state"\)\.textContent = (\(job\.words \|\| ""\)[^\n]*?);\n/, "chip");
  const line = lift(/const jobLine = \(job\) => ([^\n]*?);\n/, "line");
  const routeWords = async (status: JobStatus): Promise<Record<string, unknown>> => {
    const dir = { jobIds: async () => ["j-1"], job: () => ({ inspect: async () => ({ ok: true, job: { status, cadence: "daily at 08:30 (UTC)" }, runs: [] }) }) };
    const url = new URL("https://solo-sam.example/app/jobs");
    const res = (await appRoutes(new Request(url), url, ada.email, dir as never)) as Response;
    return ((await res.json()) as { jobs: Array<Record<string, unknown>> }).jobs[0] as Record<string, unknown>;
  };

  it("every status the engine has reads the same on the page and in the table", async () => {
    expect(STATUSES).toHaveLength(7);
    for (const st of STATUSES) {
      const job = await routeWords(st);
      expect(job.words).toBe(statusWords(st));
      const words = statusWords(st);
      expect(chip(job)).toBe(words.charAt(0).toUpperCase() + words.slice(1));
      expect(line(job)).toBe(words === "on" ? "daily at 08:30 (UTC)" : `daily at 08:30 (UTC) · ${words}`);
    }
    // The table says them as a person would (M20.1): "on", "ran", and off until turned on.
    expect([statusWords("active"), statusWords("finished"), statusWords("needs_enable")]).toEqual(["on", "ran", "off until you turn it on"]);
  });

  it("jobs_list and jobs_create answer with the table's words for an off and an on job", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 10 }), { toolCall: { id: "ls", name: "jobs_list", arguments: {} } }, { text: "Listed." });
    await w.say(ada.email, "In 10 minutes, remind me to stretch.", chat);
    const text = w.transcriptOf(ada.email).join("\n");
    expect(text).toContain(`currently ${statusWords("needs_enable")}`);
    expect(text).toContain(`${TITLE}; ${statusWords("needs_enable")};`);
    expect(text).not.toContain("needs_enable;");
  });
});
