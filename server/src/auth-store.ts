import Database from "better-sqlite3";
import { config } from "./config.js";
import * as fs from "fs";
import * as path from "path";

export interface FileRecord {
    fileKey: string;
    ownerAddress: string;
    originalFilename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    expiresAt: string;
}

class AuthStore {
    private db: Database.Database;

    constructor() {
        // Ensure data directory exists
        const dbDir = path.dirname(config.database.path);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = new Database(config.database.path);
        this.initDatabase();
    }

    private initDatabase(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS files (
                file_key TEXT PRIMARY KEY,
                owner_address TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                size INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_address);
            CREATE INDEX IF NOT EXISTS idx_files_expires ON files(expires_at);
        `);
    }

    /**
     * Record a new file upload
     */
    recordUpload(record: FileRecord): void {
        const stmt = this.db.prepare(`
            INSERT INTO files (file_key, owner_address, original_filename, content_type, size, uploaded_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            record.fileKey,
            record.ownerAddress.toLowerCase(),
            record.originalFilename,
            record.contentType,
            record.size,
            record.uploadedAt,
            record.expiresAt
        );
    }

    /**
     * Get file record by key
     */
    getFile(fileKey: string): FileRecord | null {
        const stmt = this.db.prepare(`
            SELECT file_key as fileKey, owner_address as ownerAddress, 
                   original_filename as originalFilename, content_type as contentType,
                   size, uploaded_at as uploadedAt, expires_at as expiresAt
            FROM files WHERE file_key = ?
        `);

        return stmt.get(fileKey) as FileRecord | null;
    }

    /**
     * Check if an address owns a file
     */
    isOwner(fileKey: string, address: string): boolean {
        const record = this.getFile(fileKey);
        if (!record) return false;
        return record.ownerAddress.toLowerCase() === address.toLowerCase();
    }

    /**
     * Check if a file has expired (uses server time)
     */
    isExpired(fileKey: string): boolean {
        const record = this.getFile(fileKey);
        if (!record) return true;
        // Use server's current time for expiration check
        const serverTime = new Date();
        const expiresAt = new Date(record.expiresAt);
        return serverTime > expiresAt;
    }

    /**
     * Get all files owned by an address
     */
    getFilesByOwner(ownerAddress: string): FileRecord[] {
        const stmt = this.db.prepare(`
            SELECT file_key as fileKey, owner_address as ownerAddress,
                   original_filename as originalFilename, content_type as contentType,
                   size, uploaded_at as uploadedAt, expires_at as expiresAt
            FROM files 
            WHERE owner_address = ?
            ORDER BY uploaded_at DESC
        `);

        return stmt.all(ownerAddress.toLowerCase()) as FileRecord[];
    }

    /**
     * Delete expired files from database (uses server time)
     */
    cleanupExpiredRecords(): number {
        // SQLite's datetime('now') uses server's current UTC time
        const stmt = this.db.prepare(`
            DELETE FROM files WHERE expires_at < datetime('now')
        `);

        const result = stmt.run();
        return result.changes;
    }

    /**
     * Delete a specific file record
     */
    deleteRecord(fileKey: string): boolean {
        const stmt = this.db.prepare(`DELETE FROM files WHERE file_key = ?`);
        const result = stmt.run(fileKey);
        return result.changes > 0;
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}

// Export singleton instance
export const authStore = new AuthStore();
