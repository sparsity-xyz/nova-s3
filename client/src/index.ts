#!/usr/bin/env node

import { Command } from "commander";
import * as readline from "readline";
import chalk from "chalk";
import ora from "ora";
import S3StorageAgent from "./agent.js";
import S3StorageClient from "./storage-client.js";
import { config } from "./config.js";

const program = new Command();

program
    .name("s3-agent")
    .description("AI-powered S3 storage client with x402 payment support")
    .version("1.0.0");

/**
 * Interactive chat command
 */
program
    .command("chat")
    .description("Start an interactive chat session with the S3 Storage Agent")
    .action(async () => {
        try {
            console.log(
                chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║              S3 Storage Agent (x402 Powered)                  ║
╠═══════════════════════════════════════════════════════════════╣
║  An AI assistant that helps you store and retrieve files.    ║
║  Files are stored on S3 with 10-day expiration.               ║
║  Payments are processed automatically via x402 protocol.      ║
╚═══════════════════════════════════════════════════════════════╝
`)
            );

            const spinner = ora("Initializing agent...").start();
            const agent = await S3StorageAgent.create();
            spinner.succeed("Agent initialized");

            console.log(chalk.gray(`  Wallet: ${chalk.cyan(agent.walletAddress)}`));
            console.log(chalk.gray(`  LLM: ${chalk.cyan(agent.llmProvider)}`));
            console.log(chalk.gray(`  Server: ${chalk.cyan(config.serverUrl)}`));
            console.log("");

            console.log(chalk.bold.blue("💾 S3 Storage Agent"));
            console.log(chalk.gray("Type your request in natural language."));
            console.log(chalk.gray('Press Ctrl+C to cancel. Type "exit" or "q" to quit.'));
            console.log("");

            // Track processing state
            let isProcessing = false;

            // Prompt helper with Ctrl+C handling
            const prompt = (): Promise<string> => {
                return new Promise((resolve) => {
                    const rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                    });

                    rl.on("SIGINT", () => {
                        rl.close();
                        if (isProcessing) {
                            console.log(chalk.yellow("\n  ⚠️ Operation interrupted"));
                        }
                        console.log("");
                        resolve("");
                    });

                    rl.question(chalk.green("You: "), (answer) => {
                        rl.close();
                        resolve(answer);
                    });
                });
            };

            // Interactive loop
            while (true) {
                const userInput = await prompt();
                const trimmedInput = userInput.trim();

                if (
                    trimmedInput.toLowerCase() === "exit" ||
                    trimmedInput.toLowerCase() === "quit" ||
                    trimmedInput.toLowerCase() === "q"
                ) {
                    console.log(chalk.gray("Goodbye!"));
                    process.exit(0);
                }

                if (trimmedInput.toLowerCase() === "clear") {
                    agent.clearHistory();
                    console.log(chalk.gray("  Conversation history cleared.\n"));
                    continue;
                }

                if (!trimmedInput) {
                    continue;
                }

                try {
                    const response = await agent.chat(trimmedInput);
                    console.log(chalk.blue("Agent:"), response);
                } catch (error) {
                    console.error(chalk.red("Agent:"), String(error));
                }
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Run a single command
 */
program
    .command("run")
    .description("Run a single command with the agent")
    .argument("<message>", "The message to send to the agent")
    .action(async (message: string) => {
        try {
            const spinner = ora("Initializing...").start();
            const agent = await S3StorageAgent.create();
            spinner.succeed("Ready");

            const response = await agent.chat(message);
            console.log(chalk.blue("Agent:"), response);
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Upload a file directly (no agent)
 */
program
    .command("upload")
    .description("Upload a file to S3 storage (with x402 payment)")
    .argument("<file>", "Path to the file to upload")
    .action(async (file: string) => {
        try {
            const spinner = ora("Initializing...").start();
            const client = await S3StorageClient.create();
            spinner.text = "Uploading file...";

            const result = await client.uploadFile(file);

            if (result.success) {
                spinner.succeed("File uploaded successfully");
                console.log(chalk.gray(`  File Key: ${chalk.cyan(result.fileKey)}`));
                console.log(chalk.gray(`  Expires: ${chalk.yellow(result.expiresAt)}`));
                console.log(chalk.gray(`  Size: ${result.size} bytes`));
            } else {
                spinner.fail(`Upload failed: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Upload text directly (no agent)
 */
program
    .command("upload-text")
    .description("Upload text content as a file to S3 storage")
    .argument("<content>", "The text content to upload")
    .option("-n, --name <filename>", "Filename to use", "text.txt")
    .action(async (content: string, options: { name: string }) => {
        try {
            const spinner = ora("Initializing...").start();
            const client = await S3StorageClient.create();
            spinner.text = "Uploading text...";

            const result = await client.uploadText(content, options.name);

            if (result.success) {
                spinner.succeed("Text uploaded successfully");
                console.log(chalk.gray(`  File Key: ${chalk.cyan(result.fileKey)}`));
                console.log(chalk.gray(`  Expires: ${chalk.yellow(result.expiresAt)}`));
                console.log(chalk.gray(`  Size: ${result.size} bytes`));
            } else {
                spinner.fail(`Upload failed: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Download a file directly (no agent)
 */
program
    .command("download")
    .description("Download a file from S3 storage")
    .argument("<fileKey>", "The file key to download")
    .option("-o, --output <path>", "Output file path")
    .action(async (fileKey: string, options: { output?: string }) => {
        try {
            const spinner = ora("Initializing...").start();
            const client = await S3StorageClient.create();
            spinner.text = "Downloading file...";

            const result = await client.downloadFile(fileKey);

            if (result.success && result.data) {
                if (options.output) {
                    client.saveToFile(result.data, options.output);
                    spinner.succeed(`File saved to ${options.output}`);
                } else {
                    spinner.succeed("File downloaded");
                    console.log(chalk.gray(`  Filename: ${chalk.cyan(result.filename)}`));
                    console.log(chalk.gray(`  Type: ${result.contentType}`));
                    console.log(chalk.gray(`  Size: ${result.data.length} bytes`));

                    // Show content if text
                    if (
                        result.contentType?.startsWith("text/") ||
                        result.contentType === "application/json"
                    ) {
                        console.log("");
                        console.log(chalk.bold("Content:"));
                        console.log(result.data.toString("utf-8"));
                    } else {
                        console.log(chalk.yellow("  (Binary file - use -o to save to disk)"));
                    }
                }
            } else {
                spinner.fail(`Download failed: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * List files
 */
program
    .command("list")
    .alias("ls")
    .description("List all files stored by your wallet")
    .action(async () => {
        try {
            const spinner = ora("Fetching files...").start();
            const client = await S3StorageClient.create();

            const result = await client.listFiles();

            if (result.success) {
                spinner.succeed(`Found ${result.total} file(s)`);

                if (result.files && result.files.length > 0) {
                    console.log("");
                    console.log(
                        chalk.bold(
                            `${"Filename".padEnd(30)} ${"Size".padEnd(10)} ${"Expires".padEnd(25)} File Key`
                        )
                    );
                    console.log(chalk.gray("─".repeat(100)));

                    for (const file of result.files) {
                        const size = formatSize(file.size);
                        const expires = new Date(file.expiresAt).toLocaleString();
                        console.log(
                            `${chalk.cyan(file.filename.padEnd(30))} ${size.padEnd(10)} ${chalk.yellow(expires.padEnd(25))} ${chalk.gray(file.fileKey)}`
                        );
                    }
                }
            } else {
                spinner.fail(`Failed to list files: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Get file info
 */
program
    .command("info")
    .description("Get information about a specific file")
    .argument("<fileKey>", "The file key to get info for")
    .action(async (fileKey: string) => {
        try {
            const spinner = ora("Fetching file info...").start();
            const client = await S3StorageClient.create();

            const result = await client.getFileInfo(fileKey);

            if (result.success && result.info) {
                spinner.succeed("File info retrieved");
                console.log("");
                console.log(chalk.gray(`  File Key: ${chalk.cyan(result.info.fileKey)}`));
                console.log(chalk.gray(`  Filename: ${chalk.white(result.info.filename)}`));
                console.log(chalk.gray(`  Type: ${result.info.contentType}`));
                console.log(chalk.gray(`  Size: ${formatSize(result.info.size)}`));
                console.log(chalk.gray(`  Uploaded: ${new Date(result.info.uploadedAt).toLocaleString()}`));
                console.log(chalk.gray(`  Expires: ${chalk.yellow(new Date(result.info.expiresAt).toLocaleString())}`));
            } else {
                spinner.fail(`Failed to get file info: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Show wallet info
 */
program
    .command("wallet")
    .description("Show wallet information")
    .action(async () => {
        try {
            const client = await S3StorageClient.create();
            console.log(chalk.bold("Wallet Information"));
            console.log(chalk.gray(`  Address: ${chalk.cyan(client.walletAddress)}`));
            console.log(chalk.gray(`  Server: ${chalk.blue(config.serverUrl)}`));
            console.log(chalk.gray(`  LLM Provider: ${chalk.white(config.llmProvider)}`));
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

/**
 * Delete a file
 */
program
    .command("delete")
    .alias("rm")
    .description("Delete a file from S3 storage")
    .argument("<fileKey>", "The file key to delete")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (fileKey: string, options: { yes?: boolean }) => {
        try {
            const client = await S3StorageClient.create();

            // Show file info first
            const infoResult = await client.getFileInfo(fileKey);
            if (!infoResult.success) {
                console.error(chalk.red(`File not found: ${infoResult.error}`));
                process.exit(1);
            }

            // Confirm deletion unless -y flag is passed
            if (!options.yes) {
                const readline = await import("readline");
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                const confirmed = await new Promise<boolean>((resolve) => {
                    rl.question(chalk.red("Are you sure you want to delete this file? (y/N): "), (answer) => {
                        rl.close();
                        resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
                    });
                });

                if (!confirmed) {
                    console.log(chalk.gray("Agent: Deletion cancelled."));
                    process.exit(0);
                }
            }

            const result = await client.deleteFile(fileKey);

            if (result.success) {
                console.log(chalk.blue("Agent:"), "✅ File deleted successfully!");
            } else {
                console.error(chalk.red("Agent:"), `Delete failed: ${result.error}`);
                process.exit(1);
            }
        } catch (error) {
            console.error(chalk.red("Error:"), String(error));
            process.exit(1);
        }
    });

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Default to chat if no command specified
if (process.argv.length === 2) {
    process.argv.push("chat");
}

program.parse();
