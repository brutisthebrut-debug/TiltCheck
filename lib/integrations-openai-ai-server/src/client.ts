import OpenAI from "openai";

// Prefer standard hosting-neutral names. Keep the legacy integration variables
// as fallbacks during migration so an existing environment is not broken by
// the code cutover.
const apiKey =
  process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const baseURL =
  process.env.OPENAI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY must be set to enable TiltCheck AI features.",
  );
}

export const openai = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});
