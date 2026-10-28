// Claude API の呼び出し。Worker 本体と、手元の試し打ち（tools/try-prompts.mjs）の両方から使う。
import Anthropic from "@anthropic-ai/sdk";

export async function callClaude(env, route, body) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: env.MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: env.EFFORT || "medium",
      format: { type: "json_schema", schema: route.schema }
    },
    system: route.system(),
    messages: [{ role: "user", content: route.input(body) }]
  });

  if (response.stop_reason === "refusal") throw new Error("refusal");
  if (response.stop_reason === "max_tokens") throw new Error("max_tokens");
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  return { data: JSON.parse(text), usage: response.usage };
}
