/**
 * Claude Desktop (third-party inference) setup file — pure functions.
 *
 * Claude Desktop keeps its gateway settings in a folder it manages and encrypts
 * per OS user, and Anthropic asks that scripts don't write it. Instead Cool Router
 * produces a file in Claude Desktop's own configuration format, which the user
 * loads with Developer → Configure Third-Party Inference… → Import configuration….
 * The flat format (schema v1) uses the managed-configuration key names directly.
 */

import { MODEL_MAP_TIERS, TIER_CLAUDE_MODEL_IDS } from "@/lib/modelMap/tiers";

export const CLAUDE_DESKTOP_SETUP_FILENAME = "CoolRouter-ClaudeDesktop.json";

export interface ClaudeDesktopConfig {
  $schemaVersion: 1;
  inferenceProvider: "gateway";
  inferenceGatewayBaseUrl: string;
  inferenceGatewayApiKey: string;
  inferenceGatewayAuthScheme: "bearer";
  inferenceModels: string[];
}

/**
 * Build the importable configuration. The models are full Claude ids, so the app
 * uses this list as is and doesn't need to ask Cool Router for one.
 */
export function buildClaudeDesktopConfig(baseUrl: string, apiKey: string): ClaudeDesktopConfig {
  return {
    $schemaVersion: 1,
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: baseUrl.replace(/\/+$/, "").replace(/\/v1$/, ""),
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: "bearer",
    inferenceModels: MODEL_MAP_TIERS.map((tier) => TIER_CLAUDE_MODEL_IDS[tier]),
  };
}
