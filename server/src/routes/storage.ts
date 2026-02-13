import { Hono } from "hono";
import { verifyMessage } from "viem";
import { novaS3Client } from "../nova-s3-client.js";
import { authStore } from "../auth-store.js";
import { config } from "../config.js";

const storage = new Hono();

/**
 * POST /upload
 * Upload a file to S3 storage (protected by x402 payment)
 * 
 * Headers:
 *   - X-Wallet-Address: Owner's wallet address
 *   - Content-Type: multipart/form-data
 * 
 * Body:
 *   - file: The file to upload
 */
storage.post("/upload", async (c) => {
    const walletAddress = c.req.header("X-Wallet-Address");

    if (!walletAddress) {
        return c.json({ error: "Missing X-Wallet-Address header" }, 400);
    }

    // Note: Payment was verified by middleware - no caching, every upload requires payment

    try {
        // Parse multipart form data
        const formData = await c.req.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof File)) {
            return c.json({ error: "No file provided" }, 400);
        }

        // Check file size
        if (file.size > config.file.maxSizeBytes) {
            return c.json({
                error: `File too large. Maximum size is ${config.file.maxSizeBytes / 1024 / 1024}MB`,
            }, 400);
        }

        // Generate unique file key
        const fileKey = `${walletAddress.toLowerCase()}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        // Read file as buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Store to S3 via novaS3Client
        const success = await novaS3Client.s3_put({
            key: fileKey,
            value: buffer,
            content_type: file.type || "application/octet-stream",
        });
        if (!success) {
            return c.json({ error: "Failed to upload to S3" }, 500);
        }

        // Calculate expiration date using server time
        const uploadedAt = new Date(); // Server's current time
        const expiresAt = new Date(uploadedAt);
        expiresAt.setDate(expiresAt.getDate() + config.file.expirationDays);

        // Record in database
        authStore.recordUpload({
            fileKey,
            ownerAddress: walletAddress,
            originalFilename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            uploadedAt: uploadedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
        });

        console.log(`[Storage] File uploaded: ${fileKey} by ${walletAddress}`);

        return c.json({
            success: true,
            fileKey,
            size: file.size,
            uploadedAt: uploadedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            message: `File uploaded successfully. Expires in ${config.file.expirationDays} days.`,
        });
    } catch (error) {
        console.error("[Storage] Upload error:", error);
        return c.json({ error: "Failed to upload file" }, 500);
    }
});

/**
 * GET /file/:key
 * Download a file from S3 storage
 * Only the owner can download, and file must not be expired
 * 
 * Headers:
 *   - X-Wallet-Address: Requester's wallet address
 *   - X-Signature: Signature of the file key (proves ownership)
 * 
 * Params:
 *   - key: The file key (URL encoded)
 */
storage.get("/file/:key{.+}", async (c) => {
    const fileKey = c.req.param("key");
    const walletAddress = c.req.header("X-Wallet-Address");
    const signature = c.req.header("X-Signature") as `0x${string}` | undefined;

    if (!walletAddress) {
        return c.json({ error: "Missing X-Wallet-Address header" }, 400);
    }

    if (!signature) {
        return c.json({ error: "Missing X-Signature header" }, 400);
    }

    // Verify signature - the message should be the file key
    try {
        const isValid = await verifyMessage({
            address: walletAddress as `0x${string}`,
            message: fileKey,
            signature,
        });

        if (!isValid) {
            return c.json({ error: "Invalid signature" }, 401);
        }
    } catch (error) {
        console.error("[Storage] Signature verification failed:", error);
        return c.json({ error: "Signature verification failed" }, 401);
    }

    // Check if file exists in database
    const record = authStore.getFile(fileKey);

    if (!record) {
        return c.json({ error: "File not found" }, 404);
    }

    // Check ownership
    if (!authStore.isOwner(fileKey, walletAddress)) {
        return c.json({ error: "Access denied: not the owner" }, 403);
    }

    // Check expiration
    if (authStore.isExpired(fileKey)) {
        // Clean up expired record
        authStore.deleteRecord(fileKey);
        return c.json({ error: "File has expired" }, 410);
    }

    // Download from S3
    try {
        // Download from S3 via novaS3Client
        const buffer = await novaS3Client.s3_get(fileKey);
        if (!buffer) {
            authStore.deleteRecord(fileKey);
            return c.json({ error: "File not found in storage" }, 404);
        }
        console.log(`[Storage] File downloaded: ${fileKey} by ${walletAddress}`);
        return c.body(new Uint8Array(buffer), 200, {
            "Content-Type": record.contentType,
            "Content-Disposition": `attachment; filename="${record.originalFilename}"`,
            "X-Expires-At": record.expiresAt,
        });
    } catch (error) {
        console.error("[Storage] Download error:", error);
        return c.json({ error: "Failed to download file" }, 500);
    }
});

/**
 * GET /files
 * List all files owned by the requester
 * 
 * Headers:
 *   - X-Wallet-Address: Requester's wallet address
 *   - X-Signature: Signature of "list-files" message
 */
storage.get("/files", async (c) => {
    const walletAddress = c.req.header("X-Wallet-Address");
    const signature = c.req.header("X-Signature") as `0x${string}` | undefined;

    if (!walletAddress) {
        return c.json({ error: "Missing X-Wallet-Address header" }, 400);
    }

    if (!signature) {
        return c.json({ error: "Missing X-Signature header" }, 400);
    }

    // Verify signature
    try {
        const isValid = await verifyMessage({
            address: walletAddress as `0x${string}`,
            message: "list-files",
            signature,
        });

        if (!isValid) {
            return c.json({ error: "Invalid signature" }, 401);
        }
    } catch (error) {
        console.error("[Storage] Signature verification failed:", error);
        return c.json({ error: "Signature verification failed" }, 401);
    }

    const files = authStore.getFilesByOwner(walletAddress);

    // Filter out expired files (using server time)
    const serverTime = new Date();
    const activeFiles = files.filter((file) => {
        const expiresAt = new Date(file.expiresAt);
        return serverTime <= expiresAt;
    });

    return c.json({
        files: activeFiles.map((file) => ({
            fileKey: file.fileKey,
            filename: file.originalFilename,
            contentType: file.contentType,
            size: file.size,
            uploadedAt: file.uploadedAt,
            expiresAt: file.expiresAt,
        })),
        total: activeFiles.length,
    });
});

/**
 * GET /file-info/:key
 * Get metadata for a specific file (owner only)
 * 
 * Headers:
 *   - X-Wallet-Address: Requester's wallet address
 *   - X-Signature: Signature of the file key
 */
storage.get("/file-info/:key{.+}", async (c) => {
    const fileKey = c.req.param("key");
    const walletAddress = c.req.header("X-Wallet-Address");
    const signature = c.req.header("X-Signature") as `0x${string}` | undefined;

    if (!walletAddress) {
        return c.json({ error: "Missing X-Wallet-Address header" }, 400);
    }

    if (!signature) {
        return c.json({ error: "Missing X-Signature header" }, 400);
    }

    // Verify signature
    try {
        const isValid = await verifyMessage({
            address: walletAddress as `0x${string}`,
            message: fileKey,
            signature,
        });

        if (!isValid) {
            return c.json({ error: "Invalid signature" }, 401);
        }
    } catch (error) {
        return c.json({ error: "Signature verification failed" }, 401);
    }

    const record = authStore.getFile(fileKey);

    if (!record) {
        return c.json({ error: "File not found" }, 404);
    }

    if (!authStore.isOwner(fileKey, walletAddress)) {
        return c.json({ error: "Access denied: not the owner" }, 403);
    }

    const isExpired = authStore.isExpired(fileKey);

    return c.json({
        fileKey: record.fileKey,
        filename: record.originalFilename,
        contentType: record.contentType,
        size: record.size,
        uploadedAt: record.uploadedAt,
        expiresAt: record.expiresAt,
        isExpired,
    });
});

/**
 * DELETE /file/:key
 * Delete a file from S3 storage (owner only)
 * 
 * Headers:
 *   - X-Wallet-Address: Requester's wallet address
 *   - X-Signature: Signature of the file key (proves ownership)
 * 
 * Params:
 *   - key: The file key (URL encoded)
 */
storage.delete("/file/:key{.+}", async (c) => {
    const fileKey = c.req.param("key");
    const walletAddress = c.req.header("X-Wallet-Address");
    const signature = c.req.header("X-Signature") as `0x${string}` | undefined;

    if (!walletAddress) {
        return c.json({ error: "Missing X-Wallet-Address header" }, 400);
    }

    if (!signature) {
        return c.json({ error: "Missing X-Signature header" }, 400);
    }

    // Verify signature - the message should be "delete:" + file key
    try {
        const isValid = await verifyMessage({
            address: walletAddress as `0x${string}`,
            message: `delete:${fileKey}`,
            signature,
        });

        if (!isValid) {
            return c.json({ error: "Invalid signature" }, 401);
        }
    } catch (error) {
        console.error("[Storage] Signature verification failed:", error);
        return c.json({ error: "Signature verification failed" }, 401);
    }

    // Check if file exists in database
    const record = authStore.getFile(fileKey);

    if (!record) {
        return c.json({ error: "File not found" }, 404);
    }

    // Check ownership
    if (!authStore.isOwner(fileKey, walletAddress)) {
        return c.json({ error: "Access denied: not the owner" }, 403);
    }

    // Delete from S3
    try {
        const deleted = await novaS3Client.s3_delete(fileKey);

        if (!deleted) {
            console.warn(`[Storage] File not found in S3: ${fileKey}`);
        }

        // Delete from database
        authStore.deleteRecord(fileKey);

        console.log(`[Storage] File deleted: ${fileKey} by ${walletAddress}`);

        return c.json({
            success: true,
            message: "File deleted successfully",
            fileKey,
        });
    } catch (error) {
        console.error("[Storage] Delete error:", error);
        return c.json({ error: "Failed to delete file" }, 500);
    }
});

// POST /renew/:key Renew file expiration, each renewal adds 10 days
storage.post("/renew/:key{.+}", async (c) => {
    const fileKey = c.req.param("key");
    const walletAddress = c.req.header("X-Wallet-Address");
    const signature = c.req.header("X-Signature") as `0x${string}` | undefined;
    if (!walletAddress) {
        return c.json({ error: "Missing X-Wallet-Address header" }, 400);
    }
    if (!signature) {
        return c.json({ error: "Missing X-Signature header" }, 400);
    }
    // Note: We do NOT call recordPaid() for renewals - each renewal requires payment
    // Verify signature, message is renew:<fileKey>
    try {
        const isValid = await verifyMessage({
            address: walletAddress as `0x${string}`,
            message: `renew:${fileKey}`,
            signature,
        });
        if (!isValid) {
            return c.json({ error: "Invalid signature" }, 401);
        }
    } catch (error) {
        return c.json({ error: "Signature verification failed" }, 401);
    }
    // Check file ownership
    const record = authStore.getFile(fileKey);
    if (!record) {
        return c.json({ error: "File not found" }, 404);
    }
    if (!authStore.isOwner(fileKey, walletAddress)) {
        return c.json({ error: "Access denied: not the owner" }, 403);
    }
    // Renewal logic: add 10 days using server time
    const serverTime = Date.now(); // Server's current time in milliseconds
    const oldExpires = new Date(record.expiresAt);
    // If file hasn't expired, extend from current expiration; otherwise extend from now
    const newExpires = new Date(Math.max(serverTime, oldExpires.getTime()));
    newExpires.setDate(newExpires.getDate() + 10);
    // Update database
    const db = authStore["db"];
    db.prepare("UPDATE files SET expires_at = ? WHERE file_key = ?").run(newExpires.toISOString(), fileKey);
    return c.json({ success: true, fileKey, oldExpires: record.expiresAt, newExpires: newExpires.toISOString() });
});

export default storage;
