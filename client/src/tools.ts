import S3StorageClient from "./storage-client.js";
import type { FileInfo } from "./storage-client.js";

/**
 * Tool definitions for the AI agent
 */
export interface Tool {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
}

export const tools: Tool[] = [
    {
        name: "upload_file",
        description: "Upload a file from the local filesystem to S3 storage. The file will expire in 10 days. Payment will be processed automatically.",
        input_schema: {
            type: "object",
            properties: {
                file_path: {
                    type: "string",
                    description: "The absolute or relative path to the file to upload",
                },
            },
            required: ["file_path"],
        },
    },
    {
        name: "upload_text",
        description: "Upload text content as a file to S3 storage. The file will expire in 10 days. Payment will be processed automatically.",
        input_schema: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "The text content to upload",
                },
                filename: {
                    type: "string",
                    description: "The filename to save as (e.g., 'notes.txt', 'data.json')",
                },
            },
            required: ["content", "filename"],
        },
    },
    {
        name: "download_file",
        description: "Download a file from S3 storage using its file key. Only the owner can download their files.",
        input_schema: {
            type: "object",
            properties: {
                file_key: {
                    type: "string",
                    description: "The file key returned when the file was uploaded",
                },
                save_path: {
                    type: "string",
                    description: "Optional: local path to save the downloaded file. If not provided, content will be returned as text if possible.",
                },
            },
            required: ["file_key"],
        },
    },
    {
        name: "list_files",
        description: "List all files stored by the current wallet. Shows file keys, filenames, sizes, and expiration dates.",
        input_schema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "get_file_info",
        description: "Get detailed information about a specific file, including its expiration status.",
        input_schema: {
            type: "object",
            properties: {
                file_key: {
                    type: "string",
                    description: "The file key to get information about",
                },
            },
            required: ["file_key"],
        },
    },
    {
        name: "delete_file",
        description: "Delete a file from S3 storage. Only the owner can delete their own files. This action cannot be undone.",
        input_schema: {
            type: "object",
            properties: {
                file_key: {
                    type: "string",
                    description: "The file key of the file to delete",
                },
            },
            required: ["file_key"],
        },
    },
    {
        name: "renew_file",
        description: "Renew a file's expiration by adding 10 days to its current expiration date. Only the owner can renew their files.",
        input_schema: {
            type: "object",
            properties: {
                file_key: {
                    type: "string",
                    description: "The file key of the file to renew",
                },
            },
            required: ["file_key"],
        },
    },
];

/**
 * Execute a tool call
 */
export async function executeTool(
    client: S3StorageClient,
    toolName: string,
    toolInput: Record<string, unknown>
): Promise<string> {
    switch (toolName) {
        case "upload_file": {
            const filePath = toolInput.file_path as string;
            const result = await client.uploadFile(filePath);
            if (result.success) {
                return JSON.stringify({
                    status: "success",
                    message: "File uploaded successfully",
                    fileKey: result.fileKey,
                    expiresAt: result.expiresAt,
                    size: result.size,
                });
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        case "upload_text": {
            const content = toolInput.content as string;
            const filename = toolInput.filename as string;
            const result = await client.uploadText(content, filename);
            if (result.success) {
                return JSON.stringify({
                    status: "success",
                    message: "Text uploaded successfully",
                    fileKey: result.fileKey,
                    expiresAt: result.expiresAt,
                    size: result.size,
                });
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        case "download_file": {
            const fileKey = toolInput.file_key as string;
            const savePath = toolInput.save_path as string | undefined;
            const result = await client.downloadFile(fileKey);

            if (result.success && result.data) {
                if (savePath) {
                    client.saveToFile(result.data, savePath);
                    return JSON.stringify({
                        status: "success",
                        message: `File saved to ${savePath}`,
                        filename: result.filename,
                        size: result.data.length,
                    });
                } else {
                    // Try to return as text if it's a text file
                    const isText = result.contentType?.startsWith("text/") ||
                        result.contentType === "application/json";
                    if (isText) {
                        return JSON.stringify({
                            status: "success",
                            filename: result.filename,
                            contentType: result.contentType,
                            content: result.data.toString("utf-8"),
                        });
                    } else {
                        return JSON.stringify({
                            status: "success",
                            message: "File downloaded (binary content not shown)",
                            filename: result.filename,
                            contentType: result.contentType,
                            size: result.data.length,
                            hint: "Use save_path to save binary files to disk",
                        });
                    }
                }
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        case "list_files": {
            const result = await client.listFiles();
            if (result.success) {
                const files = result.files || [];
                if (files.length === 0) {
                    return JSON.stringify({
                        status: "success",
                        message: "No files found",
                        total: 0,
                    });
                }
                return JSON.stringify({
                    status: "success",
                    total: result.total,
                    files: files.map((f: FileInfo) => ({
                        fileKey: f.fileKey,
                        filename: f.filename,
                        size: formatSize(f.size),
                        uploadedAt: f.uploadedAt,
                        expiresAt: f.expiresAt,
                    })),
                });
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        case "get_file_info": {
            const fileKey = toolInput.file_key as string;
            const result = await client.getFileInfo(fileKey);
            if (result.success && result.info) {
                return JSON.stringify({
                    status: "success",
                    ...result.info,
                    sizeFormatted: formatSize(result.info.size),
                });
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        case "delete_file": {
            const fileKey = toolInput.file_key as string;
            const result = await client.deleteFile(fileKey);
            if (result.success) {
                return JSON.stringify({
                    status: "success",
                    message: "File deleted successfully",
                    fileKey,
                });
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        case "renew_file": {
            const fileKey = toolInput.file_key as string;
            const result = await client.renewFile(fileKey);
            if (result.success) {
                return JSON.stringify({
                    status: "success",
                    message: "File expiration renewed (added 10 days)",
                    fileKey,
                    oldExpires: result.oldExpires,
                    newExpires: result.newExpires,
                });
            } else {
                return JSON.stringify({ status: "error", message: result.error });
            }
        }

        default:
            return JSON.stringify({ status: "error", message: `Unknown tool: ${toolName}` });
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
