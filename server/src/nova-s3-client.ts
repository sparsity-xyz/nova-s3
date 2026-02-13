
import axios from "axios";
import { config } from "./config.js";

export interface S3PutOptions {
    key: string;
    value: Buffer | Uint8Array | string;
    content_type?: string;
}

export interface S3PutResponse {
    success: boolean;
}

export interface S3GetResponse {
    value: string; // base64
}

export interface S3DeleteResponse {
    success: boolean;
}

export interface S3ListOptions {
    prefix?: string;
    continuation_token?: string;
    max_keys?: number;
}

export interface S3ListResponse {
    keys: string[];
    continuation_token?: string;
    is_truncated?: boolean;
    [extra: string]: any;
}

export class NovaS3Client {
    baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }

    /**
     * Store data in S3 storage
     */
    async s3_put({ key, value, content_type }: S3PutOptions): Promise<boolean> {
        const payload: any = {
            key,
            value: typeof value === "string" ? Buffer.from(value).toString("base64") : Buffer.from(value).toString("base64"),
        };
        if (content_type) payload["content_type"] = content_type;
        const res = await axios.post(`${this.baseUrl}/v1/s3/put`, payload, { timeout: 30000 });
        res.data && typeof res.data.success === "boolean";
        return res.data.success === true;
    }

    /**
     * Retrieve data from S3 storage
     */
    async s3_get(key: string): Promise<Buffer | null> {
        try {
            const res = await axios.post(`${this.baseUrl}/v1/s3/get`, { key }, { timeout: 30000 });
            if (res.status === 404) return null;
            return Buffer.from(res.data.value, "base64");
        } catch (e: any) {
            if (e.response && e.response.status === 404) return null;
            throw e;
        }
    }

    /**
     * Delete data from S3 storage
     */
    async s3_delete(key: string): Promise<boolean> {
        const res = await axios.post(`${this.baseUrl}/v1/s3/delete`, { key }, { timeout: 30000 });
        return res.data.success === true;
    }

    /**
     * List keys in S3 storage
     */
    async s3_list(opts: S3ListOptions = {}): Promise<S3ListResponse> {
        const res = await axios.post(`${this.baseUrl}/v1/s3/list`, opts, { timeout: 30000 });
        return res.data;
    }
}

export const novaS3Client = new NovaS3Client(config.novaApiRpc);
