import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Context, Next, MiddlewareHandler } from "hono";
import { config } from "../config.js";

// Track paid addresses (using wallet address as API key)
const paidAddresses = new Set<string>();

/**
 * Pricing function - can be customized based on file size
 * Returns price in smallest unit (e.g., 10000 = 0.01 USDC with 6 decimals)
 */
export type PricingFunction = (fileSizeBytes?: number) => string;

export const defaultPricingFunction: PricingFunction = (_fileSizeBytes?: number): string => {
    // Default: fixed price regardless of file size
    return config.pricing.defaultPrice;
};

/**
 * Create payment routes configuration for x402
 */
function createPaymentRoutes(price: string) {
    const paymentConfig = {
        scheme: "exact" as const,
        network: config.payment.network,
        payTo: config.payment.receivingAddress,
        price: {
            amount: price,
            asset: config.payment.paymentTokenAddress,
            extra: {
                name: config.payment.paymentTokenName,
                version: "2",
            },
        },
    };

    return {
        "POST /upload": {
            accepts: [paymentConfig],
            description: "Upload file to S3 storage (10-day expiration)"
        },
        "POST /renew/*": {
            accepts: [paymentConfig],
            description: "Renew file expiration (adds 10 days)"
        },
    };
}

/**
 * Create the x402 resource server and payment middleware
 */
export function createPaymentMiddleware(
    pricingFn: PricingFunction = defaultPricingFunction
): {
    middleware: MiddlewareHandler;
    recordPayment: (address: string) => void;
    isAddressPaid: (address: string) => boolean;
} {
    // Setup facilitator client and resource server
    const facilitatorClient = new HTTPFacilitatorClient({ url: config.payment.facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitatorClient);

    // Register the exact scheme for EVM networks
    resourceServer.register("eip155:*", new ExactEvmScheme());

    // Create routes with default pricing
    const routes = createPaymentRoutes(pricingFn());
    const paidAwareMiddleware = paymentMiddleware(routes, resourceServer);
    const protectedPaths = Object.keys(routes).map((key) => {
        const path = key.split(" ", 2)[1];
        return {
            pattern: path,
            isWildcard: path.endsWith("/*"),
            prefix: path.endsWith("/*") ? path.slice(0, -2) : path,
        };
    });

    const isProtectedPath = (requestPath: string): boolean => {
        return protectedPaths.some((p) => {
            if (p.isWildcard) {
                return requestPath.startsWith(p.prefix);
            }
            return requestPath === p.pattern;
        });
    };

    const middleware: MiddlewareHandler = async (c: Context, next: Next) => {
        if (isProtectedPath(c.req.path)) {
            const walletAddress = c.req.header("X-Wallet-Address");

            // All protected operations require payment - no caching
            console.log(
                `[x402] Payment required: ${c.req.method} ${c.req.path} wallet=${walletAddress ?? "<missing>"}`
            );
            return paidAwareMiddleware(c, next);
        }
        return next();
    };

    return {
        middleware,
        recordPayment: (address: string) => {
            paidAddresses.add(address.toLowerCase());
            console.log(`[x402] Payment recorded: wallet=${address}`);
        },
        isAddressPaid: (address: string) => {
            return paidAddresses.has(address.toLowerCase());
        },
    };
}

/**
 * Check if a given address has made a payment
 */
export function hasPaid(address: string): boolean {
    return paidAddresses.has(address.toLowerCase());
}

/**
 * Record a payment for an address
 */
export function recordPaid(address: string): void {
    paidAddresses.add(address.toLowerCase());
}
