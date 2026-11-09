// The tier-1 runs of the P8 tasks of today (F60): each task's script for `p8Harness`, shared by its `.test.ts` and by
// `planted.test.ts`, which plays the same runs with the fault planted. A chat's requests take the next step in order.
// The replies are what the room line of `WORK_WORDS` and the identity section ask of the model.
import type { FakeStep } from "../../support/fake-model.ts";
import type { P8HarnessOptions } from "./harness.ts";
import { AGENT_REPLY, MAIL_REPLY, ROOM_REPLY, VOICE_REPLY } from "./world.ts";


const text = (t: string): FakeStep => ({ text: t });

export const runs: Record<string, () => P8HarnessOptions> = {
  "T-P8-10": () => ({ script: [] }),
  "T-P8-11": () => ({ script: [text(ROOM_REPLY)] }),
  "T-P8-12": () => ({ script: [text(MAIL_REPLY)] }),
  "T-P8-14": () => ({ script: [text(AGENT_REPLY), text(AGENT_REPLY), text(AGENT_REPLY), text(MAIL_REPLY)] }),
  "T-P8-15": () => ({ script: [text(VOICE_REPLY)] }),
};
