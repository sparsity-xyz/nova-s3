#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import S3StorageClient from "./storage-client.js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const program = new Command();

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString();
}

/**
 * Calculate time remaining until expiration
 */
function getTimeRemaining(expiresAt: string): string {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();

    if (diff < 0) return chalk.red("EXPIRED");

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return chalk.green(`${days}d ${hours}h`);
    if (hours > 0) return chalk.yellow(`${hours}h`);
    return chalk.red("< 1h");
}

/**
 * Initialize client from environment
 */
async function initClient(): Promise<S3StorageClient> {
    const spinner = ora("Initializing client...").start();
    try {
        const client = await S3StorageClient.create();
        spinner.succeed(`Connected as ${chalk.cyan(client.walletAddress)}`);
        return client;
    } catch (error) {
        spinner.fail("Failed to initialize client");
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(chalk.red(`Error: ${message}`));
        console.error(chalk.yellow("\nMake sure you have set the required environment variables:"));
        console.error(chalk.yellow("  - PRIVATE_KEY"));
        console.error(chalk.yellow("  - SERVER_URL (optional, defaults to http://localhost:3000)"));
        process.exit(1);
    }
}

// Configure CLI
program
    .name("nova-s3")
    .description("Nova S3 Storage - Command-line client for decentralized file storage")
    .version("1.0.0");

/**
 * Upload command
 */
program
    .command("upload <filepath>")
    .description("Upload a file to S3 storage")
    .action(async (filepath: string) => {
        const client = await initClient();

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            console.error(chalk.red(`Error: File not found: ${filepath}`));
            process.exit(1);
        }

        const filename = path.basename(filepath);
        const spinner = ora(`Uploading ${chalk.cyan(filename)}...`).start();

        try {
            const result = await client.uploadFile(filepath);

            if (result.success) {
                spinner.succeed(chalk.green("File uploaded successfully!"));
                console.log();
                console.log(chalk.bold("📦 File Details:"));
                console.log(`  File Key:  ${chalk.cyan(result.fileKey)}`);
                console.log(`  Size:      ${formatSize(result.size!)}`);
                console.log(`  Uploaded:  ${formatDate(result.expiresAt!)}`);
                console.log(`  Expires:   ${formatDate(result.expiresAt!)} ${getTimeRemaining(result.expiresAt!)}`);
                console.log();
                console.log(chalk.gray(`Use this file key to download, renew, or delete the file.`));
            } else {
                spinner.fail(chalk.red("Upload failed"));
                console.error(chalk.red(`Error: ${result.error}`));
                process.exit(1);
            }
        } catch (error) {
            spinner.fail(chalk.red("Upload failed"));
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });

/**
 * Download command
 */
program
    .command("get <filekey> [output]")
    .description("Download a file from S3 storage")
    .action(async (filekey: string, output?: string) => {
        const client = await initClient();

        const spinner = ora("Downloading file...").start();

        try {
            const result = await client.downloadFile(filekey);

            if (result.success && result.data) {
                const outputPath = output || result.filename || "download";

                // Save to file
                client.saveToFile(result.data, outputPath);

                spinner.succeed(chalk.green("File downloaded successfully!"));
                console.log();
                console.log(chalk.bold("📥 Download Details:"));
                console.log(`  Filename:     ${chalk.cyan(result.filename)}`);
                console.log(`  Size:         ${formatSize(result.data.length)}`);
                console.log(`  Content Type: ${result.contentType}`);
                console.log(`  Saved to:     ${chalk.cyan(path.resolve(outputPath))}`);
            } else {
                spinner.fail(chalk.red("Download failed"));
                console.error(chalk.red(`Error: ${result.error}`));
                process.exit(1);
            }
        } catch (error) {
            spinner.fail(chalk.red("Download failed"));
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });

/**
 * List command
 */
program
    .command("list")
    .alias("ls")
    .description("List all your files")
    .action(async () => {
        const client = await initClient();

        const spinner = ora("Fetching files...").start();

        try {
            const result = await client.listFiles();

            if (result.success) {
                spinner.succeed(chalk.green(`Found ${result.total} file(s)`));
                console.log();

                if (result.files && result.files.length > 0) {
                    console.log(chalk.bold("📁 Your Files:"));
                    console.log();

                    result.files.forEach((file, index) => {
                        const timeRemaining = getTimeRemaining(file.expiresAt);
                        console.log(chalk.bold(`${index + 1}. ${chalk.cyan(file.filename)}`));
                        console.log(`   Key:      ${chalk.gray(file.fileKey)}`);
                        console.log(`   Size:     ${formatSize(file.size)}`);
                        console.log(`   Type:     ${file.contentType}`);
                        console.log(`   Uploaded: ${formatDate(file.uploadedAt)}`);
                        console.log(`   Expires:  ${formatDate(file.expiresAt)} (${timeRemaining})`);
                        console.log();
                    });

                    console.log(chalk.gray("💡 Tips:"));
                    console.log(chalk.gray("  - Use 'nova-s3 get <filekey>' to download a file"));
                    console.log(chalk.gray("  - Use 'nova-s3 renew <filekey>' to extend expiration"));
                    console.log(chalk.gray("  - Use 'nova-s3 delete <filekey>' to remove a file"));
                } else {
                    console.log(chalk.yellow("No files found."));
                    console.log(chalk.gray("Upload a file with: nova-s3 upload <filepath>"));
                }
            } else {
                spinner.fail(chalk.red("Failed to list files"));
                console.error(chalk.red(`Error: ${result.error}`));
                process.exit(1);
            }
        } catch (error) {
            spinner.fail(chalk.red("Failed to list files"));
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });

/**
 * Delete command
 */
program
    .command("delete <filekey>")
    .alias("rm")
    .description("Delete a file from S3 storage")
    .action(async (filekey: string) => {
        const client = await initClient();

        const spinner = ora("Deleting file...").start();

        try {
            const result = await client.deleteFile(filekey);

            if (result.success) {
                spinner.succeed(chalk.green("File deleted successfully!"));
                console.log();
                console.log(chalk.gray(`Deleted: ${filekey}`));
            } else {
                spinner.fail(chalk.red("Delete failed"));
                console.error(chalk.red(`Error: ${result.error}`));
                process.exit(1);
            }
        } catch (error) {
            spinner.fail(chalk.red("Delete failed"));
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });

/**
 * Renew command
 */
program
    .command("renew <filekey>")
    .description("Renew file expiration (adds 10 days)")
    .action(async (filekey: string) => {
        const client = await initClient();

        const spinner = ora("Renewing file expiration...").start();

        try {
            const result = await client.renewFile(filekey);

            if (result.success) {
                spinner.succeed(chalk.green("File expiration renewed!"));
                console.log();
                console.log(chalk.bold("🔄 Renewal Details:"));
                console.log(`  File Key:        ${chalk.cyan(filekey)}`);
                console.log(`  Old Expiration:  ${formatDate(result.oldExpires!)}`);
                console.log(`  New Expiration:  ${formatDate(result.newExpires!)} ${getTimeRemaining(result.newExpires!)}`);
                console.log();
                console.log(chalk.green("✓ Added 10 days to expiration"));
            } else {
                spinner.fail(chalk.red("Renewal failed"));
                console.error(chalk.red(`Error: ${result.error}`));
                process.exit(1);
            }
        } catch (error) {
            spinner.fail(chalk.red("Renewal failed"));
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });

/**
 * Info command
 */
program
    .command("info <filekey>")
    .description("Get detailed information about a file")
    .action(async (filekey: string) => {
        const client = await initClient();

        const spinner = ora("Fetching file info...").start();

        try {
            const result = await client.getFileInfo(filekey);

            if (result.success && result.info) {
                spinner.succeed(chalk.green("File information retrieved"));
                console.log();
                console.log(chalk.bold("📄 File Information:"));
                console.log(`  File Key:     ${chalk.cyan(result.info.fileKey)}`);
                console.log(`  Filename:     ${chalk.cyan(result.info.filename)}`);
                console.log(`  Size:         ${formatSize(result.info.size)}`);
                console.log(`  Content Type: ${result.info.contentType}`);
                console.log(`  Uploaded:     ${formatDate(result.info.uploadedAt)}`);
                console.log(`  Expires:      ${formatDate(result.info.expiresAt)} ${getTimeRemaining(result.info.expiresAt)}`);
            } else {
                spinner.fail(chalk.red("Failed to get file info"));
                console.error(chalk.red(`Error: ${result.error}`));
                process.exit(1);
            }
        } catch (error) {
            spinner.fail(chalk.red("Failed to get file info"));
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(chalk.red(`Error: ${message}`));
            process.exit(1);
        }
    });

/**
 * Wallet command
 */
program
    .command("wallet")
    .description("Show wallet information")
    .action(async () => {
        const client = await initClient();
        console.log();
        console.log(chalk.bold("💼 Wallet Information:"));
        console.log(`  Address: ${chalk.cyan(client.walletAddress)}`);
        console.log();
    });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
