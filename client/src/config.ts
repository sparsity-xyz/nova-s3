import "dotenv/config";

export type LLMProvider = "claude" | "openai" | "deepseek";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function optionalEnv(name: string, defaultValue: string): string {
    return process.env[name] || defaultValue;
}

function getProvider(): LLMProvider {
    const provider = optionalEnv("LLM_PROVIDER", "claude").toLowerCase();
    if (provider !== "claude" && provider !== "openai" && provider !== "deepseek") {
        throw new Error(`Invalid LLM_PROVIDER: ${provider}. Must be one of: claude, openai, deepseek`);
    }
    return provider;
}

export const config = {
    // Wallet
    privateKey: requireEnv("PRIVATE_KEY") as `0x${string}`,

    // Server
    serverUrl: optionalEnv("SERVER_URL", "http://localhost:3000"),

    // LLM Provider
    llmProvider: getProvider(),

    // OpenAI
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: optionalEnv("OPENAI_MODEL", "gpt-4o"),

    // Claude (Anthropic)
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicModel: optionalEnv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),

    // DeepSeek
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekModel: optionalEnv("DEEPSEEK_MODEL", "deepseek-chat"),
    deepseekBaseUrl: optionalEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
} as const;

export type Config = typeof config;
