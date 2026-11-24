import OpenAI from "openai";

export function openAiFailure(error: unknown, fallback: string) {
  if (error instanceof OpenAI.APIError) {
    if (error.code === "credit_balance_exhausted" || error.code === "insufficient_quota" || error.type === "insufficient_quota") {
      return { status: 503, message: "The configured OpenAI API project has no available credits. Add API credits or configure a funded OPENAI_API_KEY in .env.local and restart the app." };
    }
    if (error.status === 401 || error.status === 403) {
      return { status: 503, message: "OpenAI could not authorize this request. Check the API key and its project permissions." };
    }
    if (error.status === 429) {
      return { status: 429, message: "OpenAI is rate limiting requests. Wait a moment and try again." };
    }
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { status: 503, message: "The server could not reach OpenAI. Check the connection and try again." };
  }
  return { status: 502, message: fallback };
}
