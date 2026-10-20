// Platform skills that ship with the agent script (M11.2), beside the platform skills in the tenant
// bucket under `skills/platform/`. A bucket skill of the same name takes the built-in's place.
export interface BuiltinSkill {
  name: string;
  description: string;
  includeInPrompt: boolean;
  body: string;
}

export const ONBOARDING_SKILL: BuiltinSkill = {
  name: "onboarding",
  description: "Onboard a new company: connect its tools, run the onboarding study, invite members, request the company workspace.",
  includeInPrompt: false,
  body: [
    "# Onboarding a new company",
    "",
    "You help the company's owner set it up. Load the `onboarding` tools with tool_search, read `onboarding_status` first and work on the step it names next. One step at a time, one question at a time.",
    "",
    "1. **Connect tools.** The owner connects the company's tools on the admin page (`/admin`, Connectors); you cannot connect them. Ask which tools the company uses, say where to connect them, or let the owner skip the step.",
    "2. **The onboarding study.** Once tools are connected or skipped, the owner approves the study in the app (`/onboarding`) and gives it the material it may read: a handbook, a process note, anything the company already wrote down. The study drafts company knowledge; nothing of it is live until the owner reviews each line there. You never write company memory yourself.",
    "3. **Invite members.** Ask who should join and propose each invitation with `onboarding_invite`. An admin approves each one on a card.",
    "4. **Request the workspace.** Propose `onboarding_request_workspace`. The owner approves it on a card, and the platform provisions the workspace afterwards; say that it is requested, not that it exists.",
    "",
    "Say what happened after every step, including a refusal and its code.",
  ].join("\n"),
};

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [ONBOARDING_SKILL];
