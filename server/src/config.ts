import "dotenv/config";
import type { Network } from "@x402/core/types";

function isTrue(val: string | undefined): boolean {
    return val === "true" || val === "1";
}

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

const IN_DOCKER = isTrue(process.env.IN_DOCKER ?? "false");

export const config = {
    // Server
    port: Number(optionalEnv("PORT", "3000")),

    // AWS S3
    aws: {
        accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
        region: optionalEnv("AWS_REGION", "us-east-1"),
        bucketName: requireEnv("S3_BUCKET_NAME"),
    },

    // x402 Payment
    payment: {
        facilitatorUrl: requireEnv("FACILITATOR_URL"),
        receivingAddress: requireEnv("RECEIVING_ADDRESS") as `0x${string}`,
        paymentTokenAddress: requireEnv("PAYMENT_TOKEN_ADDRESS") as `0x${string}`,
        paymentTokenName: optionalEnv("PAYMENT_TOKEN_NAME", "Bridged USDC (SKALE Bridge)"),
        networkChainId: optionalEnv("NETWORK_CHAIN_ID", "324705682"),
        get network(): Network {
            return `eip155:${this.networkChainId}`;
        },
    },

    // Pricing
    pricing: {
        defaultPrice: optionalEnv("DEFAULT_PRICE", "20000"), // 0.02 USDC for 1GB
    },

    // File constraints
    file: {
        maxSizeBytes: Number(optionalEnv("MAX_FILE_SIZE", String(1000 * 1000 * 1000))), // 1GB in bytes
        expirationDays: Number(optionalEnv("FILE_EXPIRATION_DAYS", "10")),
    },

    // Database
    database: {
        path: optionalEnv("DATABASE_PATH", "./data/storage.db"),
    },

    // NOVA API RPC
    novaApiRpc: IN_DOCKER
        ? "http://localhost:18000"
        : "http://odyn.sparsity.cloud:18000",
} as const;

export type Config = typeof config;
