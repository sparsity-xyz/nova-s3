import S3StorageClient from "./storage-client.js";
import { tools, executeTool } from "./tools.js";
import { config } from "./config.js";
import { createLLMClient, type LLMClient, type Message } from "./llm.js";

/**
 * S3 Storage Agent - Uses LLM to understand user requests and interact with S3 storage
 * Supports Claude, OpenAI (GPT-4), and DeepSeek
 */
class S3StorageAgent {
    private llm: LLMClient;
    private client: S3StorageClient;
    private conversationHistory: Message[] = [];
    private provider: string;

    private constructor(llm: LLMClient, client: S3StorageClient, provider: string) {
        this.llm = llm;
        this.client = client;
        this.provider = provider;
    }

    static async create(): Promise<S3StorageAgent> {
        const llm = createLLMClient(config.llmProvider);
        const client = await S3StorageClient.create();

        return new S3StorageAgent(llm, client, config.llmProvider);
    }

    get walletAddress(): string {
        return this.client.walletAddress;
    }

    get llmProvider(): string {
        return this.provider;
    }

    /**
     * Process a user message and return the agent's response
     */
    async chat(userMessage: string): Promise<string> {
        // Add user message to history
        this.conversationHistory.push({
            role: "user",
            content: userMessage,
        });

        const systemPrompt = `You are a helpful S3 storage assistant. You help users store and retrieve files from a paid S3 storage service.

You have access to the following capabilities:
- Upload files from the user's local filesystem
- Upload text content as files
- Download files using their file keys
- List all files owned by the current wallet
- Get detailed information about specific files

The storage service uses x402 payment protocol. Payments are processed automatically when uploading.
Files expire after 10 days.
The current wallet address is: ${this.client.walletAddress}

When the user asks you to store something:
- If they provide a file path, use upload_file
- If they provide text content, use upload_text with an appropriate filename

When the user asks to read/download a file:
- Use download_file with the file key
- If the content is text, show it to the user
- If it's binary, suggest saving to a file

Always confirm successful operations and provide relevant details like file keys and expiration dates.`;

        let response = await this.llm.chat(systemPrompt, this.conversationHistory, tools);

        // Process tool calls in a loop
        while (response.stopReason === "tool_use" && response.toolCalls.length > 0) {
            // Process all tool calls
            const toolResults: { id: string; result: string }[] = [];

            for (const toolCall of response.toolCalls) {
                // console.log(`\n[Agent] Calling tool: ${toolCall.name}`);
                // console.log(`[Agent] Input: ${JSON.stringify(toolCall.input)}`);

                const result = await executeTool(
                    this.client,
                    toolCall.name,
                    toolCall.input
                );

                // console.log(`[Agent] Result: ${result}`);

                toolResults.push({
                    id: toolCall.id,
                    result,
                });
            }

            // Add assistant message with tool calls to history (as text representation)
            if (response.text) {
                this.conversationHistory.push({
                    role: "assistant",
                    content: response.text,
                });
            }

            // Add tool results as user message
            const toolResultSummary = toolResults
                .map((tr) => `Tool result: ${tr.result}`)
                .join("\n");
            this.conversationHistory.push({
                role: "user",
                content: toolResultSummary,
            });

            // Get next response
            response = await this.llm.chat(systemPrompt, this.conversationHistory, tools);
        }

        // Add final response to history
        if (response.text) {
            this.conversationHistory.push({
                role: "assistant",
                content: response.text,
            });
        }

        return response.text || "I completed the operation but have nothing more to say.";
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.conversationHistory = [];
    }
}

export default S3StorageAgent;
