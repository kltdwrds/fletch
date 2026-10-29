// The page world T-P1-08 reads (F20): the message controls as a person meets them, by role and label, at a width.
// Pure, like `world.ts`: the task module loads under plain Node and the root tsconfig; `surface-controls.test.ts`
// builds the world over the shipped page script.
import type { ScenarioWorld } from "../../support/scenario.ts";

/** One control as assistive technology names it. */
export interface Control {
  label: string;
  disabled: boolean;
}

/** The reaction picker a React press opens over the hover row. */
export interface Picker {
  role: string;
  label: string;
  controls: Control[];
}

/** The "Message actions" sheet the phone's ⋯ opens under a bubble. */
export interface Sheet {
  form: string;
  /** The reaction controls' labels, in order; empty when the sheet offers none. */
  emojis: string[];
  /** The action rows' words (Reply, Copy). */
  rows: string[];
}

export interface PageWorld extends ScenarioWorld {
  /** The labels of the hover row's controls under the message at 1440, in order; null when the message is not drawn. */
  hoverRow(mid: string): string[] | null;
  /** The picker the task opened on the message at 1440; null when none was opened. */
  picker(mid: string): Picker | null;
  /** The sheet the task opened on the message at 390; null when none was opened. */
  sheet(mid: string): Sheet | null;
}
