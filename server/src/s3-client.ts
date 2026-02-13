import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

export interface FileMetadata {
    key: string;
    contentType: string;
    size: number;
    expiresAt: Date;
    uploadedAt: Date;
}

export interface UploadResult {
    key: string;
    expiresAt: Date;
}

class S3StorageClient {
    private client: S3Client;
    private bucketName: string;

    constructor() {
        this.client = new S3Client({
            region: config.aws.region,
            credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey,
            },
        });
        this.bucketName = config.aws.bucketName;
    }

    /**
     * Generate a unique file key with owner prefix
     */
    generateFileKey(ownerAddress: string, originalFilename: string): string {
        const timestamp = Date.now();
        const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
        return `${ownerAddress.toLowerCase()}/${timestamp}-${sanitizedFilename}`;
    }

    /**
     * Upload a file to S3 with expiration metadata
     */
    async uploadFile(
        key: string,
        body: Buffer | Uint8Array | ReadableStream,
        contentType: string,
        ownerAddress: string
    ): Promise<UploadResult> {
        const uploadedAt = new Date();
        const expiresAt = new Date(uploadedAt.getTime() + config.file.expirationDays * 24 * 60 * 60 * 1000);

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: contentType,
            Metadata: {
                "owner-address": ownerAddress.toLowerCase(),
                "uploaded-at": uploadedAt.toISOString(),
                "expires-at": expiresAt.toISOString(),
            },
            // S3 Object Lock or Lifecycle can also be used for auto-deletion
            Expires: expiresAt,
        });

        await this.client.send(command);

        return {
            key,
            expiresAt,
        };
    }

    /**
     * Download a file from S3
     */
    async downloadFile(key: string): Promise<{
        body: ReadableStream;
        contentType: string;
        metadata: Record<string, string>;
    } | null> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            const response = await this.client.send(command);

            if (!response.Body) {
                return null;
            }

            return {
                body: response.Body.transformToWebStream(),
                contentType: response.ContentType || "application/octet-stream",
                metadata: response.Metadata || {},
            };
        } catch (error: unknown) {
            if ((error as { name?: string }).name === "NoSuchKey") {
                return null;
            }
            throw error;
        }
    }

    /**
     * Check if a file exists and get its metadata
     */
    async getFileMetadata(key: string): Promise<FileMetadata | null> {
        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            const response = await this.client.send(command);

            const metadata = response.Metadata || {};
            const uploadedAt = metadata["uploaded-at"]
                ? new Date(metadata["uploaded-at"])
                : new Date();
            const expiresAt = metadata["expires-at"]
                ? new Date(metadata["expires-at"])
                : new Date(uploadedAt.getTime() + config.file.expirationDays * 24 * 60 * 60 * 1000);

            return {
                key,
                contentType: response.ContentType || "application/octet-stream",
                size: response.ContentLength || 0,
                expiresAt,
                uploadedAt,
            };
        } catch (error: unknown) {
            if ((error as { name?: string }).name === "NotFound") {
                return null;
            }
            throw error;
        }
    }

    /**
     * Delete a file from S3
     */
    async deleteFile(key: string): Promise<boolean> {
        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            await this.client.send(command);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if a file has expired
     */
    isExpired(expiresAt: Date): boolean {
        return new Date() > expiresAt;
    }
}

// Export singleton instance
export const s3Client = new S3StorageClient();
