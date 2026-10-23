import type { ProviderCallParams } from "./inferenceProviders/types";
import { API_ENDPOINTS, buildApiUrl } from "../../config/constants";
import { wrapCleanupTranscript } from "../../config/prompts";
import logger from "../../utils/logger";
import { responsesReasoningEffort } from "./chatRequestBody";
import { abortOnCancel, isRequestCancelled, requestCancelledError } from "./requestCancellation";
import {
  getLlmRequestTimeoutSeconds,
  llmRequestTimeoutError,
} from "../../helpers/llmRequestTimeout.js";
import { redactProviderBody } from "../../helpers/providerHttpErrors.js";

// Used when the plan call fails (plan limit hit, sign-in expired, network error).
const FALLBACK_URL = "https://api.mistral.ai/v1/chat/completions";
const FALLBACK_MODEL = "ministral-8b-latest";

/**
 * OpenAI cleanup on the user's ChatGPT plan ("Sign in with ChatGPT"). The plan
 * route takes the Responses API with `store: false` and `stream: true`, the
 * system prompt as `instructions`, and no `temperature` or `max_output_tokens`:
 * https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
 * Any failure falls back to Mistral, so dictation never stops.
 */
export async function callChatGPTPlan(params: ProviderCallParams, token: string): Promise<string> {
  const startTime = Date.now();
  try {
    const text = await streamPlanResponse(params, token);
    logger.logReasoning("CHATGPT_PLAN_SUCCESS", {
      model: params.model,
      processingTimeMs: Date.now() - startTime,
    });
    return text;
  } catch (error) {
    if (isRequestCancelled(params.config.requestId)) throw error;
    const mistralKey = await window.electronAPI.getMistralKey();
    logger.logReasoning("CHATGPT_PLAN_FALLBACK", {
      model: params.model,
      error: (error as Error).message,
      hasMistralKey: !!mistralKey,
    });
    if (!mistralKey) throw error;
    return params.ctx.callChatCompletionsApi(
      FALLBACK_URL,
      mistralKey,
      FALLBACK_MODEL,
      params.text,
      params.agentName,
      params.config,
      "Mistral"
    );
  }
}

async function streamPlanResponse(
  { text, model, agentName, config, ctx }: ProviderCallParams,
  token: string
): Promise<string> {
  const userText = config.systemPrompt ? text : wrapCleanupTranscript(text);
  const effort = responsesReasoningEffort(model, "openai", config, API_ENDPOINTS.OPENAI_BASE);
  const body = {
    model,
    instructions: config.systemPrompt || ctx.getSystemPrompt(agentName, config.toneStyle),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          ...(config.screenContext
            ? [
                {
                  type: "input_image",
                  image_url: `data:${config.screenContext.mediaType};base64,${config.screenContext.data}`,
                },
              ]
            : []),
        ],
      },
    ],
    store: false,
    stream: true,
    ...(effort ? { reasoning: { effort } } : {}),
  };

  const controller = new AbortController();
  const timeoutSeconds = getLlmRequestTimeoutSeconds({ scope: config.inferenceScope });
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const unlinkCancel = abortOnCancel(config.requestId, controller);
  try {
    const res = await fetch(buildApiUrl(API_ENDPOINTS.OPENAI_BASE, "/responses"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const errorText = await res.text();
      throw new Error(`ChatGPT plan error ${res.status}: ${redactProviderBody(errorText)}`);
    }

    // Server-sent events: collect the text deltas until the response completes.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let output = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data);
        if (parsed.type === "response.output_text.delta") output += parsed.delta;
        if (parsed.type === "response.failed" || parsed.type === "error") {
          const error = parsed.response?.error ?? parsed.error ?? parsed;
          throw new Error(`ChatGPT plan error: ${error.code ?? ""} ${error.message ?? ""}`.trim());
        }
      }
    }
    if (!output.trim()) throw new Error("ChatGPT plan returned no text");
    return output.trim();
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      if (isRequestCancelled(config.requestId)) throw requestCancelledError();
      throw llmRequestTimeoutError(timeoutSeconds);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    unlinkCancel();
  }
}
