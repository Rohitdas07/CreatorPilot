import type { GoogleGenAI } from '@google/genai';

export const PRIMARY_GEMINI_TEXT_MODEL = 'gemini-4-hydrogen';
export const FALLBACK_GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite';

let primaryCooldownUntilMs = 0;

export async function withGeminiTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateGeminiContentWithFallback(params: {
  ai: GoogleGenAI;
  contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];
  config?: Parameters<GoogleGenAI['models']['generateContent']>[0]['config'];
  label: string;
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
  onFallback?: (reason: string) => void;
}): Promise<{
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
  modelUsed: string;
}> {
  const primaryTimeout = params.primaryTimeoutMs ?? 15000;
  const fallbackTimeout = params.fallbackTimeoutMs ?? 30000;
  const now = Date.now();

  if (now >= primaryCooldownUntilMs) {
    try {
      const response = await withGeminiTimeout(
        params.ai.models.generateContent({
          model: PRIMARY_GEMINI_TEXT_MODEL,
          contents: params.contents,
          config: params.config,
        }),
        primaryTimeout,
        params.label
      );
      return { response, modelUsed: PRIMARY_GEMINI_TEXT_MODEL };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (
        lower.includes('api_key_invalid') ||
        lower.includes('api key not valid') ||
        lower.includes('invalid api key')
      ) {
        throw err;
      }
      const isDailyQuota =
        lower.includes('perday') ||
        lower.includes('daily') ||
        lower.includes('429') ||
        lower.includes('resource_exhausted');
      primaryCooldownUntilMs = Date.now() + (isDailyQuota ? 15 * 60 * 1000 : 3 * 60 * 1000);
      params.onFallback?.(msg);
    }
  } else {
    params.onFallback?.(`primary model ${PRIMARY_GEMINI_TEXT_MODEL} on cooldown`);
  }

  const { thinkingConfig: _omitThinking, ...restConfig } = (params.config || {}) as Record<string, unknown>;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await withGeminiTimeout(
        params.ai.models.generateContent({
          model: FALLBACK_GEMINI_TEXT_MODEL,
          contents: params.contents,
          config: restConfig as Parameters<GoogleGenAI['models']['generateContent']>[0]['config'],
        }),
        fallbackTimeout,
        `${params.label} (${FALLBACK_GEMINI_TEXT_MODEL})`
      );
      return { response, modelUsed: FALLBACK_GEMINI_TEXT_MODEL };
    } catch (fallbackErr) {
      const fMsg = (fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)).toLowerCase();
      const isTransient =
        fMsg.includes('503') ||
        fMsg.includes('unavailable') ||
        fMsg.includes('timed out') ||
        fMsg.includes('high demand') ||
        fMsg.includes('internal');
      if (attempt < 2 && isTransient) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      throw fallbackErr;
    }
  }
  throw new Error(`${params.label} failed on ${FALLBACK_GEMINI_TEXT_MODEL}.`);
}
