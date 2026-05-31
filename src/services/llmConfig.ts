const STORAGE_KEY = 'geosurgical-llm-config';

export type LlmProvider = 'mock' | 'ollama' | 'openai' | 'siliconflow' | 'custom';

export type LlmConfig = {
  provider: LlmProvider;
  endpoint: string;
  model: string;
  apiKey: string;
};

const DEFAULTS: Record<LlmProvider, Omit<LlmConfig, 'provider' | 'apiKey'>> = {
  mock:        { endpoint: '',                            model: '' },
  ollama:      { endpoint: 'http://localhost:11434',      model: 'qwen2.5:7b' },
  openai:      { endpoint: 'https://api.openai.com',      model: 'gpt-4o-mini' },
  siliconflow: { endpoint: 'https://api.siliconflow.cn',  model: 'deepseek-ai/DeepSeek-V3' },
  custom:      { endpoint: '',                            model: '' },
};

export function getDefaultConfig(provider: LlmProvider): LlmConfig {
  return { provider, apiKey: '', ...DEFAULTS[provider] };
}

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LlmConfig;
      if (parsed.provider && DEFAULTS[parsed.provider]) return parsed;
    }
  } catch { /* ignore */ }

  // Auto-detect from .env
  const envEndpoint = import.meta.env.VITE_LLM_ENDPOINT as string | undefined;
  const envApiKey   = import.meta.env.VITE_LLM_API_KEY   as string | undefined;
  const envModel    = import.meta.env.VITE_LLM_MODEL      as string | undefined;
  const brainMode   = import.meta.env.VITE_BRAIN_MODE      as string | undefined;

  if (brainMode === 'mock') return getDefaultConfig('mock');

  if (envEndpoint) {
    const provider = detectProvider(envEndpoint);
    return {
      provider,
      endpoint: envEndpoint,
      model: envModel ?? DEFAULTS[provider].model,
      apiKey: envApiKey ?? '',
    };
  }

  return getDefaultConfig('mock');
}

export function saveLlmConfig(config: LlmConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearLlmConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function detectProvider(endpoint: string): LlmProvider {
  const lower = endpoint.toLowerCase();
  if (lower.includes('siliconflow')) return 'siliconflow';
  if (lower.includes('openai')) return 'openai';
  if (lower.includes('deepseek')) return 'openai';
  if (lower.includes('localhost:11434') || lower.includes('127.0.0.1:11434')) return 'ollama';
  return 'custom';
}
