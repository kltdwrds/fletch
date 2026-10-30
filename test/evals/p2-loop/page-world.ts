// The page world the P2 page tasks read (T-P2-04, T-P2-10, T-P2-11): the thread as the shipped page script draws it.
// Pure, like `world.ts`: the task modules load under plain Node and the root tsconfig; a test builds the world over
// the page harness and the production engine.
import type { ScenarioWorld } from "../../support/scenario.ts";
import type { Entry, Frame } from "./world.ts";

/** One thing drawn in the thread, in order: a message's side and words, its reactions' emoji, or a card. */
export interface Drawn {
  kind: string;
  text: string;
  reactions: string[];
}

/** What tells Sam a turn is running: the thinking dots in the thread, the status line's words, the stop control. */
export interface Working {
  dots: boolean;
  status: string | null;
  stop: boolean;
}

export interface LoopPageWorld extends ScenarioWorld {
  /** The thread as drawn now. */
  drawn(): Drawn[];
  /** The history entries the page was given, in order (the chat's stored record). */
  stored(): Entry[];
  /** The tool result rows in the chat's transcript. */
  toolRows(): Array<{ tool: string; text: string }>;
  working(): Working;
  /** Every frame the page was given. */
  frames(): Frame[];
  /** After each played turn, by the turn's name: what was working and how many messages were drawn. */
  seen(): Array<{ after: string; working: Working; drawn: number; anchors: number; cards: number }>;
  /** The links drawn in the thread. */
  anchors(): Array<{ href: string; text: string }>;
  /** The file cards drawn in the thread (F24). */
  fileCards(): Array<{ name: string; kind: string }>;
}
