// M25.4: the verify pass on every upkeep batch. The first lens is "the burden of proof is on the mutation": a proposed
// claim is applied only when the verify step names a handle, the citation of the very line the claim cites; a missing
// verdict, a hold, or a handle that is absent or another line's holds it, and a held mutation is never applied. The
// guard is code, so each case scripts the verifier (or the model upstream of it) to do the wrong thing and shows the
// claim table unchanged.
import { describe, expect, it } from "vitest";
import { VERIFY_INSTRUCTIONS } from "../../packages/agent/src/loops/personal.ts";
import { ada, answer, applyAll, personLoopWorld, T0 } from "./support/loop-world.ts";

const HOUR = 3_600_000;
const claims = (w: ReturnType<typeof personLoopWorld>, p: string) => w.of(p).mem.rows<{ quote: string }>("SELECT quote FROM claims ORDER BY quote").map((r) => r.quote);
const dropped = (w: ReturnType<typeof personLoopWorld>, p: string) => w.of(p).loops.reconciliations("memory-upkeep").flatMap((r) => r.dropped.map((d) => d.code));

describe("[M25.4] verify pass on reconciliation", () => {
  it("the first lens is the burden of proof on the mutation, and a verified mutation is applied", async () => {
    expect(VERIFY_INSTRUCTIONS).toContain("The burden of proof is on the mutation");
    const w = personLoopWorld();
    const l = await w.write(ada.email, "Ada's standup is at 9.");
    w.fake.enqueue(answer({ claims: [{ kind: "fact", text: "Ada's standup is at 9.", cite: l }] }), applyAll([l]));
    expect(await w.of(ada.email).loops.upkeep(T0)).toMatchObject({ signal: "notify", calls: 2 });
    expect(claims(w, ada.email)).toEqual(["Ada's standup is at 9."]);
    // The verifier saw the evidence line and the numbered mutation, fenced as data, with the lens in its instructions.
    const verifyInput = w.inputs()[1] ?? "";
    expect(verifyInput).toContain("burden of proof is on the mutation");
    expect(verifyInput).toContain('source=\\"memory:evidence-lines\\"');
    expect(verifyInput).toContain("1. [fact] Ada's standup is at 9.");
  });

  it("a mutation the verifier gives no handle is held and never applied; the others in the batch still are", async () => {
    const w = personLoopWorld();
    const a = await w.write(ada.email, "Ada prefers short replies.");
    const b = await w.write(ada.email, "Ada's standup is at 9.");
    w.fake.enqueue(
      answer({ claims: [{ kind: "preference", text: "Ada prefers short replies.", cite: a }, { kind: "fact", text: "Ada's standup is at 9.", cite: b }] }),
      answer({ verdicts: [{ n: 1, verdict: "apply" }, { n: 2, verdict: "apply", handle: b }] }),
    );
    const ran = await w.of(ada.email).loops.upkeep(T0);
    expect(ran).toMatchObject({ signal: "notify", calls: 2 });
    expect(claims(w, ada.email)).toEqual(["Ada's standup is at 9."]);
    expect(dropped(w, ada.email)).toEqual(["LOOP_HELD_NO_HANDLE"]);
    const [rec] = w.of(ada.email).loops.reconciliations("memory-upkeep");
    expect(rec?.dropped[0]).toMatchObject({ code: "LOOP_HELD_NO_HANDLE", text: "Ada prefers short replies." });
  });

  it("a handle that names another line, a hold, a missing verdict and an unparseable verifier each hold the mutation", async () => {
    const w = personLoopWorld();
    const a = await w.write(ada.email, "Ada prefers short replies.");
    const b = await w.write(ada.email, "Ada's standup is at 9.");
    const c = await w.write(ada.email, "Ada reviews the harbor budget on Thursdays.");
    const proposal = answer({
      claims: [
        { kind: "preference", text: "Ada prefers short replies.", cite: a },
        { kind: "fact", text: "Ada's standup is at 9.", cite: b },
        { kind: "fact", text: "Ada reviews the harbor budget on Thursdays.", cite: c },
      ],
    });
    // The verifier points the first claim at the second claim's line, holds the second, and says nothing of the third.
    w.fake.enqueue(proposal, answer({ verdicts: [{ n: 1, verdict: "apply", handle: b }, { n: 2, verdict: "hold", reason: "the line says 10" }] }));
    await w.of(ada.email).loops.upkeep(T0);
    expect(claims(w, ada.email)).toEqual([]);
    expect(dropped(w, ada.email)).toEqual(["LOOP_HELD_NO_HANDLE", "LOOP_HELD_BY_VERIFIER", "LOOP_HELD_UNVERIFIED"]);
    // Every line is behind the watermark: held mutations are listed, not retried into the model every hour.
    expect(await w.of(ada.email).loops.upkeep(T0 + HOUR)).toMatchObject({ code: "LOOP_NO_EVIDENCE", calls: 0 });

    // A verifier that answers prose: nothing is applied.
    const d = await w.write(ada.email, "Ada keeps the blue binder.");
    w.fake.enqueue(answer({ claims: [{ kind: "fact", text: "Ada keeps the blue binder.", cite: d }] }), { text: "Looks good to me, apply everything." });
    const ran = await w.of(ada.email).loops.upkeep(T0 + 2 * HOUR);
    expect(ran).toMatchObject({ ok: false, signal: "failed", code: "LOOP_OUTPUT_UNPARSEABLE" });
    expect(claims(w, ada.email)).toEqual([]);
  });

  it("a verify call the budget refuses ends the run blocked with nothing applied and the watermark unmoved, so the batch is verified later", async () => {
    const w = personLoopWorld();
    const l = await w.write(ada.email, "Ada's standup is at 9.");
    // 600 tokens: the proposal's 500 fit; the verify step has 100 left of the run's ceiling and is refused.
    w.of(ada.email).loops.setLoop(ada.email, "memory-upkeep", { budget: 600 });
    w.fake.enqueue(answer({ claims: [{ kind: "fact", text: "Ada's standup is at 9.", cite: l }] }));
    const ran = await w.of(ada.email).loops.upkeep(T0);
    expect(ran).toMatchObject({ ok: false, signal: "blocked" });
    expect(claims(w, ada.email)).toEqual([]);
    expect(w.of(ada.email).loops.reconciliations("memory-upkeep")).toEqual([]);
    // The next day, the batch is still evidence; the claim lands once it is verified.
    w.clock.now = T0 + 24 * HOUR;
    w.of(ada.email).loops.setLoop(ada.email, "memory-upkeep", { budget: 60_000 });
    w.fake.enqueue(answer({ claims: [{ kind: "fact", text: "Ada's standup is at 9.", cite: l }] }), applyAll([l]));
    expect(await w.of(ada.email).loops.upkeep(T0 + 24 * HOUR)).toMatchObject({ signal: "notify", calls: 2 });
    expect(claims(w, ada.email)).toEqual(["Ada's standup is at 9."]);
  });
});
