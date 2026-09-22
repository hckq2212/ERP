export const QC_SETTING_KEY = "qc";

export type QcOption = { value: string; label: string };

export const QC_PROVIDER_OPTIONS: QcOption[] = [
    { value: "groq", label: "Groq" },
    { value: "openai", label: "OpenAI" },
    { value: "openrouter", label: "OpenRouter" },
];

export const QC_MODEL_OPTIONS: Record<string, QcOption[]> = {
    groq: [
        { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B (mạnh, khuyên dùng)" },
        { value: "qwen/qwen3.6-27b", label: "Qwen3.6 27B (mạnh nhất)" },
        { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B (nhanh, rẻ)" },
    ],
    openai: [
        { value: "gpt-4o-mini", label: "GPT-4o mini" },
        { value: "luna", label: "Luna" },
        { value: "terra", label: "Terra" },
        { value: "sol", label: "Sol" },
    ],
    openrouter: [
        { value: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini (qua OpenRouter)" },
        { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (qua OpenRouter)" },
        { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash (qua OpenRouter)" },
        { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (qua OpenRouter)" },
    ],
};

export const QC_MAX_BATCH_MIN = 1;
export const QC_MAX_BATCH_MAX = 50;
export const QC_MAX_CONTEXT_MIN = 1000;
export const QC_MAX_CONTEXT_MAX = 200000;

export const QC_DEFAULT_CONFIG = {
    provider: QC_PROVIDER_OPTIONS[0].value,
    verifyModel: QC_MODEL_OPTIONS[QC_PROVIDER_OPTIONS[0].value][0].value,
    maxBatch: 4,
    maxContext: 8000,
};

export type QcConfig = {
    provider: string;
    verifyModel: string;
    maxBatch: number;
    maxContext: number;
};

export const isValidQcConfig = (config: Partial<QcConfig> | null | undefined): config is QcConfig => {
    if (!config?.provider || !config?.verifyModel) return false;
    if (!(QC_MODEL_OPTIONS[config.provider] || []).some((model) => model.value === config.verifyModel)) return false;

    const maxBatch = config.maxBatch;
    const maxContext = config.maxContext;
    if (!Number.isInteger(maxBatch) || maxBatch < QC_MAX_BATCH_MIN || maxBatch > QC_MAX_BATCH_MAX) return false;
    if (!Number.isInteger(maxContext) || maxContext < QC_MAX_CONTEXT_MIN || maxContext > QC_MAX_CONTEXT_MAX) return false;

    return true;
};
