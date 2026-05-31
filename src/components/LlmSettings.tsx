import { useState, useEffect, useCallback } from 'react';
import { Settings, X, Save } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  type LlmConfig,
  type LlmProvider,
  loadLlmConfig,
  saveLlmConfig,
  clearLlmConfig,
  getDefaultConfig,
} from '../services/llmConfig';

const PROVIDERS: LlmProvider[] = ['mock', 'ollama', 'openai', 'siliconflow', 'custom'];

type Props = {
  onChange?: (config: LlmConfig) => void;
};

export function LlmSettings({ onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<LlmConfig>(loadLlmConfig);

  useEffect(() => {
    onChange?.(config);
  }, [config, onChange]);

  const handleProviderChange = useCallback((provider: LlmProvider) => {
    const defaults = getDefaultConfig(provider);
    setConfig((prev) => ({ ...prev, provider, endpoint: defaults.endpoint, model: defaults.model }));
  }, []);

  const handleSave = useCallback(() => {
    saveLlmConfig(config);
    setOpen(false);
    onChange?.(config);
  }, [config, onChange]);

  const handleReset = useCallback(() => {
    clearLlmConfig();
    const fresh = loadLlmConfig();
    setConfig(fresh);
    onChange?.(fresh);
  }, [onChange]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded-md p-1.5 transition ${open ? 'bg-zinc-200 text-zinc-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
        title={t('llm.settings')}
        aria-label={t('llm.settings')}
        aria-expanded={open}
      >
        <Settings size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-zinc-200 bg-white p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700">{t('llm.settings')}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {/* Provider selector */}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-zinc-500">{t('llm.provider')}</span>
              <select
                value={config.provider}
                onChange={(e) => handleProviderChange(e.target.value as LlmProvider)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-zinc-400"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{t(`llm.provider.${p}`)}</option>
                ))}
              </select>
            </label>

            {config.provider !== 'mock' && (
              <>
                {/* Endpoint */}
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-zinc-500">{t('llm.endpoint')}</span>
                  <input
                    type="text"
                    value={config.endpoint}
                    onChange={(e) => setConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                    placeholder="http://localhost:11434"
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none placeholder:text-zinc-300 focus:border-zinc-400"
                  />
                </label>

                {/* Model */}
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-zinc-500">{t('llm.model')}</span>
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                    placeholder="qwen2.5:7b"
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none placeholder:text-zinc-300 focus:border-zinc-400"
                  />
                </label>

                {/* API Key */}
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-zinc-500">{t('llm.apiKey')}</span>
                  <input
                    type="password"
                    value={config.apiKey}
                    onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="sk-..."
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none placeholder:text-zinc-300 focus:border-zinc-400"
                  />
                  <span className="text-[10px] text-zinc-400">{t('llm.apiKeyHint')}</span>
                </label>
              </>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-white transition hover:bg-zinc-700"
              >
                <Save size={12} />
                {t('llm.save')}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700"
              >
                {t('llm.reset')}
              </button>
            </div>

            {/* Current status */}
            <div className="rounded-md bg-zinc-50 px-2 py-1.5 text-[10px] text-zinc-400">
              {config.provider === 'mock'
                ? t('llm.statusMock')
                : `${config.provider} · ${config.model || '(no model)'}`
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
