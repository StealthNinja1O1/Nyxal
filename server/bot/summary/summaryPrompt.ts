import type { RuntimeCharacter } from "../types";
import type { PromptMessage } from "../prompt";

/**
 * Build the summarization prompt. Returns the messages array to send to the
 * main generateResponse() entrypoint.
 */
export function buildSummaryPrompt(
  character: RuntimeCharacter,
  userName: string,
  segment: PromptMessage[],
  priorSummaries: string[],
  charName: string,
): Array<{ role: "system" | "user"; content: string }> {
  const charDescription = character.description || "";
  const charPersona = character.systemPrompt || "";

  const lines = segment
    .map((m) => {
      const text = stripSpeakerPrefix(m.content).trim();
      if (!text) return null;
      const role = m.role === "assistant" ? charName : m.content.split(":")[0]?.trim() || userName;
      return `${role}: ${text}`;
    })
    .filter((line): line is string => line !== null);
  const transcript = lines.length > 0 ? lines.join("\n\n") : "(no text messages in this segment)";

  const priorBlock =
    priorSummaries.length > 0
      ? `\n\nFor continuity, here is what you already recall about earlier parts of this conversation:\n${priorSummaries
          .map((s, i) => `(${i + 1}) ${s}`)
          .join("\n")}\nDo not repeat this. Only summarize the NEW transcript below.`
      : "";

  const system = `You are ${charName}. ${charPersona ? charPersona + "\n\n" : ""}${
    charDescription ? `About you: ${charDescription}\n\n` : ""
  }Your task: write a private memory note, in your OWN voice and from your OWN perspective, recapping a segment of your ongoing Discord conversation with ${userName} and others.

Rules:
- Write as ${charName} recalling events, first person. Not a neutral narrator.
- Capture concrete facts: what was discussed, decisions made, who said/did what, any promises, plans, jokes, conflicts, relationship shifts, and notable emotional beats.
- Be specific and information-dense. Prefer names, numbers, and concrete details over vague summaries.
- Do NOT invent or speculate. Only record what actually appears in the transcript.
- Do NOT include greetings, pleasantries, or meta-commentary ("here is a summary"). Just the recap.
- Keep it tight: aim for a few short paragraphs at most.
- You may use bullet points for clarity.${priorBlock}`;

  const user = `Transcript to summarize:\n\n${transcript}\n\nWrite your memory note now, in your voice as ${charName}.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * The transcript lines already carry a "DisplayName (username - id): ..." prefix
 * from formatMessagesForAI. For the summary we want the speaker name only once.
 * This strips a leading "Name (...): " so we can re-add a clean label.
 */
function stripSpeakerPrefix(content: string): string {
  const m = content.match(/^[^(:]*\([^)]*\)\s*-\s*\d+\s*:\s*([\s\S]*)$/);
  if (m) return m[1]!;
  return content;
}
