import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { createPaymentMiddleware } from "./middleware/payment.js";
import storage from "./routes/storage.js";
import { authStore } from "./auth-store.js";

const app = new Hono();

async function main() {
    // Middleware
    app.use("*", cors());
    app.use("*", logger());

    // Create payment middleware
    const { middleware: paymentMiddleware } = createPaymentMiddleware();

    // Apply payment middleware
    app.use("*", paymentMiddleware);

    // Health check
    app.get("/", (c) => {
        return c.json({
            service: "S3 Storage Server",
            version: "1.0.0",
            description: "x402-powered S3 file storage with 10-day expiration",
            endpoints: {
                "GET /": "Service information and available endpoints",
                "GET /health": "Health check endpoint",
                "POST /upload": "💰 Upload a file (requires x402 payment)",
                "GET /file/:key": "🔐 Download a file (owner only, requires signature)",
                "GET /files": "🔐 List your files (requires signature)",
                "GET /file-info/:key": "🔐 Get file metadata (owner only, requires signature)",
                "DELETE /file/:key": "🔐 Delete a file (owner only, requires signature)",
                "POST /renew/:key": "💰🔐 Renew file expiration - adds 10 days (requires x402 payment + signature)",
            },
            legend: {
                "💰": "Requires x402 payment",
                "🔐": "Requires wallet signature",
            },
            pricing: {
                upload: {
                    price: config.pricing.defaultPrice,
                    description: "Each upload requires payment",
                },
                renewal: {
                    price: config.pricing.defaultPrice,
                    description: "Each renewal requires payment",
                },
                unit: "Price in smallest token unit (e.g., 10000 = 0.01 USDC with 6 decimals)",
            },
            limits: {
                maxFileSize: `${config.file.maxSizeBytes / 1000 / 1000}MB`,
                expirationDays: config.file.expirationDays,
            },
            payment: {
                network: config.payment.network,
                token: config.payment.paymentTokenName,
                receivingAddress: config.payment.receivingAddress,
                facilitatorUrl: config.payment.facilitatorUrl,
            },
        });
    });

    // Health endpoint
    app.get("/health", (c) => {
        return c.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Mount storage routes
    app.route("/", storage);

    // Cleanup job - run every hour
    setInterval(() => {
        const cleaned = authStore.cleanupExpiredRecords();
        if (cleaned > 0) {
            console.log(`[Cleanup] Removed ${cleaned} expired file records`);
        }
    }, 60 * 60 * 1000);

    // Graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n[Server] Shutting down...");
        authStore.close();
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        console.log("\n[Server] Terminating...");
        authStore.close();
        process.exit(0);
    });

    // Start server
    serve({ fetch: app.fetch, port: config.port }, () => {
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   S3 Storage Server                           ║
╠═══════════════════════════════════════════════════════════════╣
║  🚀 Server running on http://localhost:${config.port.toString().padEnd(24)}║
║  📡 Facilitator: ${config.payment.facilitatorUrl.substring(0, 42).padEnd(44)}║
║  💰 Payments to: ${config.payment.receivingAddress.substring(0, 42).padEnd(44)}║
║  🔗 Network: ${config.payment.network.padEnd(48)}║
║  🪙 Token: ${config.payment.paymentTokenName.substring(0, 50).padEnd(50)}║
║  📦 Max file size: ${(config.file.maxSizeBytes / 1024 / 1024).toString().padEnd(4)}MB                                   ║
║  ⏰ File expiration: ${config.file.expirationDays.toString().padEnd(4)}days                                ║
╚═══════════════════════════════════════════════════════════════╝
        `);
    });
}

main().catch(console.error);
