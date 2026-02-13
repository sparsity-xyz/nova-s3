import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config, type LLMProvider } from "./config.js";
import { tools, type Tool } from "./tools.js";

/**
 * Unified message format for conversation history
 */
export interface Message {
    role: "user" | "assistant";
    content: string;
}

export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface LLMResponse {
    text: string;
    toolCalls: ToolCall[];
    stopReason: "end_turn" | "tool_use";
}

/**
 * Abstract LLM client interface
 */
interface LLMClient {
    chat(
        systemPrompt: string,
        messages: Message[],
        tools: Tool[],
        pendingToolResults?: { id: string; result: string }[]
    ): Promise<LLMResponse>;
}

/**
 * Claude (Anthropic) client implementation
 */
class ClaudeClient implements LLMClient {
    private client: Anthropic;
    private model: string;
    private internalHistory: Anthropic.MessageParam[] = [];

    constructor() {
        if (!config.anthropicApiKey) {
            throw new Error("ANTHROPIC_API_KEY is required for Claude provider");
        }
        this.client = new Anthropic({ apiKey: config.anthropicApiKey });
        this.model = config.anthropicModel;
    }

    async chat(
        systemPrompt: string,
        messages: Message[],
        toolDefs: Tool[],
        pendingToolResults?: { id: string; result: string }[]
    ): Promise<LLMResponse> {
        // Build messages for Anthropic format
        this.internalHistory = messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        // If there are pending tool results, we need to add them
        if (pendingToolResults && pendingToolResults.length > 0) {
            this.internalHistory.push({
                role: "user",
                content: pendingToolResults.map((tr) => ({
                    type: "tool_result" as const,
                    tool_use_id: tr.id,
                    content: tr.result,
                })),
            });
        }

        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            system: systemPrompt,
            tools: toolDefs as Anthropic.Tool[],
            messages: this.internalHistory,
        });

        const toolCalls: ToolCall[] = [];
        let text = "";

        for (const block of response.content) {
            if (block.type === "text") {
                text += block.text;
            } else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    input: block.input as Record<string, unknown>,
                });
            }
        }

        return {
            text,
            toolCalls,
            stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        };
    }
}

/**
 * OpenAI client implementation (also used for DeepSeek)
 */
class OpenAIClient implements LLMClient {
    private client: OpenAI;
    private model: string;

    constructor(provider: "openai" | "deepseek") {
        if (provider === "openai") {
            if (!config.openaiApiKey) {
                throw new Error("OPENAI_API_KEY is required for OpenAI provider");
            }
            this.client = new OpenAI({ apiKey: config.openaiApiKey });
            this.model = config.openaiModel;
        } else {
            if (!config.deepseekApiKey) {
                throw new Error("DEEPSEEK_API_KEY is required for DeepSeek provider");
            }
            this.client = new OpenAI({
                apiKey: config.deepseekApiKey,
                baseURL: config.deepseekBaseUrl,
            });
            this.model = config.deepseekModel;
        }
    }

    async chat(
        systemPrompt: string,
        messages: Message[],
        toolDefs: Tool[],
        pendingToolResults?: { id: string; result: string }[]
    ): Promise<LLMResponse> {
        // Build messages for OpenAI format
        const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...messages.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
            })),
        ];

        // Add tool results if pending
        if (pendingToolResults && pendingToolResults.length > 0) {
            for (const tr of pendingToolResults) {
                openaiMessages.push({
                    role: "tool",
                    tool_call_id: tr.id,
                    content: tr.result,
                });
            }
        }

        // Convert tools to OpenAI format
        const openaiTools: OpenAI.ChatCompletionTool[] = toolDefs.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
            },
        }));

        const response = await this.client.chat.completions.create({
            model: this.model,
            max_tokens: 4096,
            messages: openaiMessages,
            tools: openaiTools,
        });

        const choice = response.choices[0];
        const toolCalls: ToolCall[] = [];

        if (choice.message.tool_calls) {
            for (const tc of choice.message.tool_calls) {
                toolCalls.push({
                    id: tc.id,
                    name: tc.function.name,
                    input: JSON.parse(tc.function.arguments),
                });
            }
        }

        return {
            text: choice.message.content || "",
            toolCalls,
            stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        };
    }
}

/**
 * Factory function to create LLM client based on provider
 */
export function createLLMClient(provider: LLMProvider): LLMClient {
    switch (provider) {
        case "claude":
            return new ClaudeClient();
        case "openai":
            return new OpenAIClient("openai");
        case "deepseek":
            return new OpenAIClient("deepseek");
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

export type { LLMClient };
