/**
 * Claude target normalizer.
 *
 * Claude Code (and Claude Desktop) shape each request for the model id they believe
 * they are talking to. Behind a Cool Router route, a request that says
 * `claude-opus-5-5` may be served by an older Claude model, which rejects
 * features it doesn't have with a 400:
 *  - `thinking: { type: "adaptive" }` exists from the 4.6 generation on;
 *  - `output_config.effort` exists on Opus 4.5+, Sonnet 4.6+ and Haiku 5+, and the
 *    `xhigh` / `max` levels only from 4.7 on;
 *  - thinking blocks replayed from another provider have no Anthropic signature.
 *
 * The normalizer only touches what the actual target model can't accept and leaves
 * everything else byte-for-byte, so prompt caching keeps working. Model ids it can't
 * parse are left alone.
 */

type JsonRecord = Record<string, unknown>;

export interface ClaudeModelVersion {
  family: "opus" | "sonnet" | "haiku" | "fable";
  version: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a Claude model id into family and version, e.g.
 * `claude-opus-4-6` → opus 4.6, `claude-sonnet-4-5-20250929` → sonnet 4.5,
 * `claude-3-5-haiku-20241022` → haiku 3.5, `claude-fable-5-2` → fable 5.2.
 */
export function parseClaudeModelVersion(modelId: unknown): ClaudeModelVersion | null {
  const id = String(modelId || "")
    .toLowerCase()
    .split("/")
    .pop()
    .replace(/\[1m\]$/, "");
  if (!id.includes("claude")) return null;

  const familyMatch = id.match(/(opus|sonnet|haiku|fable)/);
  if (!familyMatch) return null;
  const family = familyMatch[1] as ClaudeModelVersion["family"];

  // Newer ids: claude-<family>-<major>[-<minor>][-<date>]
  const after = id.slice(id.indexOf(family) + family.length);
  const newer = after.match(/^-(\d{1,2})(?:[-.](\d{1,2}))?(?=$|[-@.])/);
  if (newer) {
    const major = Number(newer[1]);
    const minor = newer[2] ? Number(newer[2]) : 0;
    return { family, version: major + minor / 10 };
  }

  // Older ids: claude-<major>[-<minor>]-<family>
  const before = id.slice(0, id.indexOf(family));
  const older = before.match(/claude-(\d{1,2})(?:[-.](\d{1,2}))?-$/);
  if (older) {
    const major = Number(older[1]);
    const minor = older[2] ? Number(older[2]) : 0;
    return { family, version: major + minor / 10 };
  }

  return null;
}

function supportsAdaptiveThinking(target: ClaudeModelVersion): boolean {
  if (target.family === "fable") return true;
  if (target.family === "haiku") return target.version >= 5;
  return target.version >= 4.6;
}

function supportsEffort(target: ClaudeModelVersion): boolean {
  if (target.family === "fable") return true;
  if (target.family === "opus") return target.version >= 4.5;
  if (target.family === "sonnet") return target.version >= 4.6;
  return target.version >= 5;
}

function supportsExtendedEffort(target: ClaudeModelVersion): boolean {
  if (target.family === "fable") return true;
  return target.version >= 4.7 && supportsEffort(target);
}

const DEFAULT_THINKING_BUDGET = 16000;
const MIN_THINKING_BUDGET = 1024;

function budgetFor(body: JsonRecord): number {
  const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : 0;
  if (maxTokens > MIN_THINKING_BUDGET + 1) {
    return Math.max(MIN_THINKING_BUDGET, Math.min(DEFAULT_THINKING_BUDGET, maxTokens - 1));
  }
  return MIN_THINKING_BUDGET;
}

/** Remove thinking blocks that carry no Anthropic signature (replayed from other providers). */
function stripUnsignedThinking(messages: unknown): { messages: unknown; changed: boolean } {
  if (!Array.isArray(messages)) return { messages, changed: false };
  let changed = false;
  const next = messages.map((message) => {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }
    const kept = message.content.filter((block) => {
      if (!isRecord(block)) return true;
      if (block.type === "thinking") {
        return typeof block.signature === "string" && block.signature.length > 0;
      }
      if (block.type === "redacted_thinking") {
        return typeof block.data === "string" && block.data.length > 0;
      }
      return true;
    });
    if (kept.length === message.content.length) return message;
    changed = true;
    return {
      ...message,
      content: kept.length > 0 ? kept : [{ type: "text", text: "(no content)" }],
    };
  });
  return { messages: changed ? next : messages, changed };
}

/**
 * Adjust an Anthropic Messages request body for the Claude model that will actually
 * serve it. Returns the same object when nothing needed changing.
 */
export function normalizeClaudeRequestForTarget(
  body: JsonRecord,
  targetModel: unknown
): JsonRecord {
  if (!isRecord(body)) return body;
  let result = body;
  const copy = () => {
    if (result === body) result = { ...body };
    return result;
  };

  const stripped = stripUnsignedThinking(body.messages);
  if (stripped.changed) copy().messages = stripped.messages;

  const target = parseClaudeModelVersion(targetModel);
  if (!target) return result;

  const thinking = isRecord(body.thinking) ? body.thinking : null;
  if (thinking?.type === "adaptive" && !supportsAdaptiveThinking(target)) {
    copy().thinking = { type: "enabled", budget_tokens: budgetFor(body) };
  }

  const outputConfig = isRecord(body.output_config) ? body.output_config : null;
  if (outputConfig && typeof outputConfig.effort === "string") {
    if (!supportsEffort(target)) {
      const { effort: _effort, ...rest } = outputConfig;
      if (Object.keys(rest).length > 0) copy().output_config = rest;
      else delete copy().output_config;
    } else if (
      (outputConfig.effort === "xhigh" || outputConfig.effort === "max") &&
      !supportsExtendedEffort(target)
    ) {
      copy().output_config = { ...outputConfig, effort: "high" };
    }
  }

  return result;
}
