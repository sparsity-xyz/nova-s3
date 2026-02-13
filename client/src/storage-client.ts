import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createPublicClient, http, type PublicClient } from "viem";
import { skaleChain } from "./chain.js";
import { config } from "./config.js";
import * as fs from "fs";
import * as path from "path";

export interface UploadResult {
    success: boolean;
    fileKey?: string;
    expiresAt?: string;
    size?: number;
    error?: string;
}

export interface DownloadResult {
    success: boolean;
    data?: Buffer;
    filename?: string;
    contentType?: string;
    error?: string;
}

export interface FileInfo {
    fileKey: string;
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    expiresAt: string;
}

export interface ListResult {
    success: boolean;
    files?: FileInfo[];
    total?: number;
    error?: string;
}

/**
 * S3 Storage Client with x402 payment support
 */
class S3StorageClient {
    private httpClient: x402HTTPClient;
    private account: PrivateKeyAccount;
    private publicClient: PublicClient;
    private serverUrl: string;

    private constructor(
        httpClient: x402HTTPClient,
        account: PrivateKeyAccount,
        publicClient: PublicClient,
        serverUrl: string
    ) {
        this.httpClient = httpClient;
        this.account = account;
        this.publicClient = publicClient;
        this.serverUrl = serverUrl;
    }

    static async create(): Promise<S3StorageClient> {
        const account = privateKeyToAccount(config.privateKey);
        const evmScheme = new ExactEvmScheme(account);
        const coreClient = new x402Client().register("eip155:*", evmScheme);
        const httpClient = new x402HTTPClient(coreClient);

        const publicClient = createPublicClient({
            chain: skaleChain,
            transport: http(),
        });

        return new S3StorageClient(httpClient, account, publicClient, config.serverUrl);
    }

    get walletAddress(): string {
        return this.account.address;
    }

    /**
     * Upload a file to S3 storage (handles x402 payment automatically)
     */
    async uploadFile(filePath: string): Promise<UploadResult> {
        console.log(`Uploading file: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            return { success: false, error: `File not found: ${filePath}` };
        }

        const fileBuffer = fs.readFileSync(filePath);
        const filename = path.basename(filePath);
        const contentType = this.guessContentType(filename);

        return this.uploadBuffer(fileBuffer, filename, contentType);
    }

    /**
     * Upload text content as a file
     */
    async uploadText(content: string, filename: string = "text.txt"): Promise<UploadResult> {
        console.log(`Uploading text as: ${filename}`);
        const buffer = Buffer.from(content, "utf-8");
        return this.uploadBuffer(buffer, filename, "text/plain");
    }

    /**
     * Upload a buffer to S3 storage
     */
    async uploadBuffer(
        buffer: Buffer,
        filename: string,
        contentType: string
    ): Promise<UploadResult> {
        const url = `${this.serverUrl}/upload`;

        try {
            // Create form data
            const formData = new FormData();
            const uint8Array = new Uint8Array(buffer);
            const blob = new Blob([uint8Array], { type: contentType });
            formData.append("file", blob, filename);

            // First attempt
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "X-Wallet-Address": this.account.address,
                },
                body: formData,
            });

            if (response.status === 402) {
                return this.handlePaymentAndUpload(response, url, formData);
            }

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Upload failed: ${response.status} - ${error}` };
            }

            const data = await response.json();
            return {
                success: true,
                fileKey: data.fileKey,
                expiresAt: data.expiresAt,
                size: data.size,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: message };
        }
    }

    /**
     * Handle x402 payment and retry upload
     */
    private async handlePaymentAndUpload(
        response: Response,
        url: string,
        formData: FormData
    ): Promise<UploadResult> {
        console.log("Payment required (402), processing payment...");

        try {
            const responseBody = await response.json();

            const paymentRequired = this.httpClient.getPaymentRequiredResponse(
                (name: string) => response.headers.get(name),
                responseBody
            );

            const paymentPayload = await this.httpClient.createPaymentPayload(paymentRequired);
            console.log("Payment signed, sending...");

            const paymentHeaders = this.httpClient.encodePaymentSignatureHeader(paymentPayload);

            // Retry with payment
            const paidResponse = await fetch(url, {
                method: "POST",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    ...paymentHeaders,
                },
                body: formData,
            });

            if (!paidResponse.ok) {
                const errorBody = await paidResponse.text();
                return { success: false, error: `Payment failed: ${paidResponse.status} - ${errorBody}` };
            }

            const settlement = this.httpClient.getPaymentSettleResponse(
                (name: string) => paidResponse.headers.get(name)
            );

            if (settlement?.transaction) {
                console.log(`Payment settled, tx: ${settlement.transaction}`);
            }

            const data = await paidResponse.json();
            console.log("File uploaded successfully after payment!");

            return {
                success: true,
                fileKey: data.fileKey,
                expiresAt: data.expiresAt,
                size: data.size,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error("Payment processing failed:", message);
            return { success: false, error: message };
        }
    }

    /**
     * Download a file from S3 storage
     */
    async downloadFile(fileKey: string): Promise<DownloadResult> {
        console.log(`Downloading file: ${fileKey}`);

        try {
            // Sign the file key to prove ownership
            const signature = await this.account.signMessage({ message: fileKey });

            const url = `${this.serverUrl}/file/${encodeURIComponent(fileKey)}`;
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    "X-Signature": signature,
                },
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Download failed: ${response.status} - ${error}` };
            }

            const contentDisposition = response.headers.get("Content-Disposition");
            let filename = "download";
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="([^"]+)"/);
                if (match) filename = match[1];
            }

            const arrayBuffer = await response.arrayBuffer();
            const data = Buffer.from(arrayBuffer);

            return {
                success: true,
                data,
                filename,
                contentType: response.headers.get("Content-Type") || "application/octet-stream",
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: message };
        }
    }

    /**
     * List all files owned by this wallet
     */
    async listFiles(): Promise<ListResult> {
        console.log("Listing files...");

        try {
            // Sign "list-files" message
            const signature = await this.account.signMessage({ message: "list-files" });

            const url = `${this.serverUrl}/files`;
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    "X-Signature": signature,
                },
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `List failed: ${response.status} - ${error}` };
            }

            const data = await response.json();
            return {
                success: true,
                files: data.files,
                total: data.total,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: message };
        }
    }

    /**
     * Get file info
     */
    async getFileInfo(fileKey: string): Promise<{ success: boolean; info?: FileInfo; error?: string }> {
        try {
            const signature = await this.account.signMessage({ message: fileKey });

            const url = `${this.serverUrl}/file-info/${encodeURIComponent(fileKey)}`;
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    "X-Signature": signature,
                },
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Get info failed: ${response.status} - ${error}` };
            }

            const info = await response.json();
            return { success: true, info };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: message };
        }
    }

    /**
     * Delete a file from S3 storage
     */
    async deleteFile(fileKey: string): Promise<{ success: boolean; error?: string }> {
        console.log(`Deleting file: ${fileKey}`);

        try {
            // Sign "delete:" + file key to prove ownership and intent
            const signature = await this.account.signMessage({ message: `delete:${fileKey}` });

            const url = `${this.serverUrl}/file/${encodeURIComponent(fileKey)}`;
            const response = await fetch(url, {
                method: "DELETE",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    "X-Signature": signature,
                },
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Delete failed: ${response.status} - ${error}` };
            }

            console.log(`File deleted: ${fileKey}`);
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: message };
        }
    }

    /**
     * Renew a file's expiration by adding 10 days (handles x402 payment automatically)
     */
    async renewFile(fileKey: string): Promise<{
        success: boolean;
        oldExpires?: string;
        newExpires?: string;
        error?: string
    }> {
        console.log(`Renewing file: ${fileKey}`);

        try {
            // Sign "renew:" + file key to prove ownership and intent
            const signature = await this.account.signMessage({ message: `renew:${fileKey}` });

            const url = `${this.serverUrl}/renew/${encodeURIComponent(fileKey)}`;
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    "X-Signature": signature,
                },
            });

            // Handle payment required
            if (response.status === 402) {
                return this.handlePaymentAndRenew(response, url, signature);
            }

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Renew failed: ${response.status} - ${error}` };
            }

            const data = await response.json();
            console.log(`File renewed: ${fileKey}`);
            console.log(`  Old expiration: ${data.oldExpires}`);
            console.log(`  New expiration: ${data.newExpires}`);

            return {
                success: true,
                oldExpires: data.oldExpires,
                newExpires: data.newExpires,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: message };
        }
    }

    /**
     * Handle x402 payment and retry renewal
     */
    private async handlePaymentAndRenew(
        response: Response,
        url: string,
        signature: string
    ): Promise<{
        success: boolean;
        oldExpires?: string;
        newExpires?: string;
        error?: string
    }> {
        console.log("Payment required (402), processing payment...");

        try {
            const responseBody = await response.json();

            const paymentRequired = this.httpClient.getPaymentRequiredResponse(
                (name: string) => response.headers.get(name),
                responseBody
            );

            const paymentPayload = await this.httpClient.createPaymentPayload(paymentRequired);
            console.log("Payment signed, sending...");

            const paymentHeaders = this.httpClient.encodePaymentSignatureHeader(paymentPayload);

            // Retry with payment
            const paidResponse = await fetch(url, {
                method: "POST",
                headers: {
                    "X-Wallet-Address": this.account.address,
                    "X-Signature": signature,
                    ...paymentHeaders,
                },
            });

            if (!paidResponse.ok) {
                const errorBody = await paidResponse.text();
                return { success: false, error: `Payment failed: ${paidResponse.status} - ${errorBody}` };
            }

            const settlement = this.httpClient.getPaymentSettleResponse(
                (name: string) => paidResponse.headers.get(name)
            );

            if (settlement?.transaction) {
                console.log(`Payment settled, tx: ${settlement.transaction}`);
            }

            const data = await paidResponse.json();
            console.log("File renewed successfully after payment!");
            console.log(`  Old expiration: ${data.oldExpires}`);
            console.log(`  New expiration: ${data.newExpires}`);

            return {
                success: true,
                oldExpires: data.oldExpires,
                newExpires: data.newExpires,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error("Payment processing failed:", message);
            return { success: false, error: message };
        }
    }

    /**
     * Save downloaded file to disk
     */
    saveToFile(data: Buffer, outputPath: string): void {
        fs.writeFileSync(outputPath, data);
        console.log(`File saved to: ${outputPath}`);
    }

    private guessContentType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
            ".txt": "text/plain",
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
            ".xml": "application/xml",
            ".pdf": "application/pdf",
            ".zip": "application/zip",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".mp3": "audio/mpeg",
            ".mp4": "video/mp4",
        };
        return mimeTypes[ext] || "application/octet-stream";
    }
}

export default S3StorageClient;
