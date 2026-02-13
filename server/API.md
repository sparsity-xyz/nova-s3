# Nova S3 Storage Server API Documentation

## Overview

The Nova S3 Storage Server is a decentralized file storage service powered by x402 payment protocol. Files are stored with a configurable expiration period (default: 10 days) and can be renewed by paying additional fees.

**Base URL**: `http://localhost:3000` (configurable via `PORT` environment variable)

**Payment Protocol**: x402 (Ethereum-based micropayments)

**Network**: SKALE Network (Europa Hub)

---

## Authentication & Payment

### Payment Flow (x402)

Protected endpoints (marked with 💰) require x402 payment:

1. **First Request**: Returns `402 Payment Required` with payment details
2. **Sign Payment**: Client signs the payment payload
3. **Retry Request**: Include payment signature in headers
4. **Success**: Server verifies payment and processes request

### Signature Authentication

Some endpoints require wallet signature to prove ownership:

- **Header**: `X-Signature`
- **Purpose**: Proves the requester owns the private key for the wallet address
- **Message Format**: Varies by endpoint (documented below)

### Common Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Wallet-Address` | Yes (most endpoints) | Ethereum wallet address (0x...) |
| `X-Signature` | Yes (some endpoints) | Signed message proving ownership |
| `X-Payment-Signature` | Conditional | Payment signature (x402 protocol) |

---

## Endpoints

### 1. Health & Info

#### `GET /`

Get service information and available endpoints.

**Authentication**: None required

**Response**: `200 OK`
```json
{
  "service": "S3 Storage Server",
  "version": "1.0.0",
  "description": "x402-powered S3 file storage with 10-day expiration",
  "endpoints": {
    "GET /": "Service information and available endpoints",
    "GET /health": "Health check endpoint",
    "POST /upload": "💰 Upload a file (requires x402 payment)",
    "GET /file/:key": "🔐 Download a file (owner only, requires signature)",
    "GET /files": "🔐 List your files (requires signature)",
    "GET /file-info/:key": "🔐 Get file metadata (owner only, requires signature)",
    "DELETE /file/:key": "🔐 Delete a file (owner only, requires signature)",
    "POST /renew/:key": "💰🔐 Renew file expiration - adds 10 days (requires x402 payment + signature)"
  },
  "legend": {
    "💰": "Requires x402 payment",
    "🔐": "Requires wallet signature"
  },
  "pricing": {
    "upload": {
      "price": "10000",
      "description": "Each upload requires payment"
    },
    "renewal": {
      "price": "10000",
      "description": "Each renewal requires payment"
    },
    "unit": "Price in smallest token unit (e.g., 10000 = 0.01 USDC with 6 decimals)"
  },
  "limits": {
    "maxFileSize": "10MB",
    "expirationDays": 10
  },
  "payment": {
    "network": "eip155:324705682",
    "token": "Bridged USDC (SKALE Bridge)",
    "receivingAddress": "0x...",
    "facilitatorUrl": "https://..."
  }
}
```

---

#### `GET /health`

Simple health check endpoint.

**Authentication**: None required

**Response**: `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2025-02-13T10:00:00.000Z"
}
```

---

### 2. File Operations

#### `POST /upload` 💰

Upload a file to S3 storage. Files expire after the configured period (default: 10 days).

**Authentication**: x402 Payment + Wallet Address

**Headers**:
- `X-Wallet-Address`: Your wallet address
- `Content-Type`: `multipart/form-data`

**Request Body**:
- `file`: File to upload (multipart/form-data)

**Max File Size**: 10MB (configurable)

**Response**: `200 OK`
```json
{
  "success": true,
  "fileKey": "0x1234.../1707825600000-example.txt",
  "size": 1024,
  "uploadedAt": "2025-02-13T10:00:00.000Z",
  "expiresAt": "2025-02-23T10:00:00.000Z",
  "message": "File uploaded successfully. Expires in 10 days."
}
```

**Error Responses**:

- `400 Bad Request`: Missing wallet address or file
  ```json
  { "error": "Missing X-Wallet-Address header" }
  { "error": "No file provided" }
  { "error": "File too large. Maximum size is 10MB" }
  ```

- `402 Payment Required`: Payment needed (x402 flow)
  ```json
  {
    "paymentRequired": {
      "scheme": "exact",
      "network": "eip155:324705682",
      "payTo": "0x...",
      "price": { "amount": "10000", "asset": "0x..." }
    }
  }
  ```

- `500 Internal Server Error`: Upload failed
  ```json
  { "error": "Failed to upload to S3" }
  ```

**Example**:
```bash
curl -X POST http://localhost:3000/upload \
  -H "X-Wallet-Address: 0x1234..." \
  -F "file=@example.txt"
```

---

#### `GET /file/:key` 🔐

Download a file from storage. Only the file owner can download.

**Authentication**: Wallet Signature

**Headers**:
- `X-Wallet-Address`: Your wallet address
- `X-Signature`: Signature of the file key

**Signature Message**: The file key itself
```
Message to sign: "0x1234.../1707825600000-example.txt"
```

**Response**: `200 OK` (Binary file data)

**Response Headers**:
- `Content-Type`: File's original content type
- `Content-Disposition`: `attachment; filename="original-filename.txt"`
- `X-Expires-At`: ISO 8601 expiration date

**Error Responses**:

- `400 Bad Request`: Missing required headers
  ```json
  { "error": "Missing X-Wallet-Address header" }
  { "error": "Missing X-Signature header" }
  ```

- `401 Unauthorized`: Invalid signature
  ```json
  { "error": "Invalid signature" }
  ```

- `403 Forbidden`: Not the owner
  ```json
  { "error": "Access denied: not the owner" }
  ```

- `404 Not Found`: File doesn't exist
  ```json
  { "error": "File not found" }
  { "error": "File not found in storage" }
  ```

- `410 Gone`: File has expired
  ```json
  { "error": "File has expired" }
  ```

**Example**:
```bash
curl -X GET http://localhost:3000/file/0x1234.../1707825600000-example.txt \
  -H "X-Wallet-Address: 0x1234..." \
  -H "X-Signature: 0xabcd..." \
  -o downloaded-file.txt
```

---

#### `GET /files` 🔐

List all files owned by your wallet.

**Authentication**: Wallet Signature

**Headers**:
- `X-Wallet-Address`: Your wallet address
- `X-Signature`: Signature of "list-files"

**Signature Message**: Fixed string
```
Message to sign: "list-files"
```

**Response**: `200 OK`
```json
{
  "files": [
    {
      "fileKey": "0x1234.../1707825600000-example.txt",
      "filename": "example.txt",
      "contentType": "text/plain",
      "size": 1024,
      "uploadedAt": "2025-02-13T10:00:00.000Z",
      "expiresAt": "2025-02-23T10:00:00.000Z"
    },
    {
      "fileKey": "0x1234.../1707825700000-image.png",
      "filename": "image.png",
      "contentType": "image/png",
      "size": 204800,
      "uploadedAt": "2025-02-13T11:00:00.000Z",
      "expiresAt": "2025-02-23T11:00:00.000Z"
    }
  ],
  "total": 2
}
```

**Note**: Only returns active (non-expired) files.

**Error Responses**:

- `400 Bad Request`: Missing required headers
- `401 Unauthorized`: Invalid signature

**Example**:
```bash
curl -X GET http://localhost:3000/files \
  -H "X-Wallet-Address: 0x1234..." \
  -H "X-Signature: 0xabcd..."
```

---

#### `GET /file-info/:key` 🔐

Get detailed metadata for a specific file.

**Authentication**: Wallet Signature

**Headers**:
- `X-Wallet-Address`: Your wallet address
- `X-Signature`: Signature of the file key

**Signature Message**: The file key itself
```
Message to sign: "0x1234.../1707825600000-example.txt"
```

**Response**: `200 OK`
```json
{
  "fileKey": "0x1234.../1707825600000-example.txt",
  "filename": "example.txt",
  "contentType": "text/plain",
  "size": 1024,
  "uploadedAt": "2025-02-13T10:00:00.000Z",
  "expiresAt": "2025-02-23T10:00:00.000Z",
  "isExpired": false
}
```

**Error Responses**:

- `400 Bad Request`: Missing required headers
- `401 Unauthorized`: Invalid signature
- `403 Forbidden`: Not the owner
- `404 Not Found`: File doesn't exist

**Example**:
```bash
curl -X GET http://localhost:3000/file-info/0x1234.../1707825600000-example.txt \
  -H "X-Wallet-Address: 0x1234..." \
  -H "X-Signature: 0xabcd..."
```

---

#### `DELETE /file/:key` 🔐

Delete a file from storage. Only the owner can delete.

**Authentication**: Wallet Signature

**Headers**:
- `X-Wallet-Address`: Your wallet address
- `X-Signature`: Signature of "delete:" + file key

**Signature Message**: Prefixed with "delete:"
```
Message to sign: "delete:0x1234.../1707825600000-example.txt"
```

**Response**: `200 OK`
```json
{
  "success": true,
  "message": "File deleted successfully",
  "fileKey": "0x1234.../1707825600000-example.txt"
}
```

**Error Responses**:

- `400 Bad Request`: Missing required headers
- `401 Unauthorized`: Invalid signature
- `403 Forbidden`: Not the owner
- `404 Not Found`: File doesn't exist
- `500 Internal Server Error`: Delete operation failed

**Example**:
```bash
curl -X DELETE http://localhost:3000/file/0x1234.../1707825600000-example.txt \
  -H "X-Wallet-Address: 0x1234..." \
  -H "X-Signature: 0xabcd..."
```

---

#### `POST /renew/:key` 💰🔐

Renew a file's expiration by adding 10 days. Requires payment for each renewal.

**Authentication**: x402 Payment + Wallet Signature

**Headers**:
- `X-Wallet-Address`: Your wallet address
- `X-Signature`: Signature of "renew:" + file key

**Signature Message**: Prefixed with "renew:"
```
Message to sign: "renew:0x1234.../1707825600000-example.txt"
```

**Response**: `200 OK`
```json
{
  "success": true,
  "fileKey": "0x1234.../1707825600000-example.txt",
  "oldExpires": "2025-02-23T10:00:00.000Z",
  "newExpires": "2025-03-05T10:00:00.000Z"
}
```

**Renewal Logic**:
- If file hasn't expired: Adds 10 days to current expiration date
- If file already expired: Adds 10 days from now

**Error Responses**:

- `400 Bad Request`: Missing required headers
- `401 Unauthorized`: Invalid signature
- `402 Payment Required`: Payment needed (x402 flow)
- `403 Forbidden`: Not the owner
- `404 Not Found`: File doesn't exist

**Example**:
```bash
curl -X POST http://localhost:3000/renew/0x1234.../1707825600000-example.txt \
  -H "X-Wallet-Address: 0x1234..." \
  -H "X-Signature: 0xabcd..."
```

---

## File Key Format

File keys follow this pattern:
```
{wallet_address}/{timestamp}-{sanitized_filename}
```

Example:
```
0x1234567890abcdef1234567890abcdef12345678/1707825600000-my_document.pdf
```

- **Wallet Address**: Lowercase Ethereum address
- **Timestamp**: Unix timestamp in milliseconds
- **Filename**: Original filename with special characters replaced by underscores

---

## Payment Details

### Pricing

- **Default Price**: `10000` (0.01 USDC with 6 decimals)
- **Token**: Bridged USDC on SKALE Europa Hub
- **Network**: `eip155:324705682` (SKALE Europa Hub)

### Protected Operations

| Endpoint | Cost | Description |
|----------|------|-------------|
| `POST /upload` | Default price | Upload a new file |
| `POST /renew/:key` | Default price | Extend file expiration by 10 days |

### Payment Policy

**Upload Operations**: Each upload requires payment. Every file upload costs the configured price.

**Renewal Operations**: Each renewal requires payment. Every time you extend a file's expiration by 10 days, you pay the configured price.

**No Payment Caching**: All paid operations require payment every time. This ensures fair pricing for storage usage.

---

## Error Handling

### Standard Error Format

```json
{
  "error": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| `200` | Success | Operation completed successfully |
| `400` | Bad Request | Missing headers, invalid input |
| `401` | Unauthorized | Invalid signature |
| `402` | Payment Required | x402 payment needed |
| `403` | Forbidden | Not the file owner |
| `404` | Not Found | File doesn't exist |
| `410` | Gone | File expired |
| `500` | Internal Server Error | Server-side failure |

---

## Rate Limiting

Currently, no rate limiting is implemented. Consider implementing rate limiting for production use.

---

## CORS

CORS is enabled for all origins (`*`). Configure appropriately for production.

---

## Environment Variables

### Required

- `AWS_ACCESS_KEY_ID`: AWS access key for S3
- `AWS_SECRET_ACCESS_KEY`: AWS secret key for S3
- `S3_BUCKET_NAME`: S3 bucket name
- `FACILITATOR_URL`: x402 facilitator URL
- `RECEIVING_ADDRESS`: Ethereum address to receive payments
- `PAYMENT_TOKEN_ADDRESS`: ERC20 token address for payments

### Optional

- `PORT`: Server port (default: `3000`)
- `AWS_REGION`: AWS region (default: `us-east-1`)
- `PAYMENT_TOKEN_NAME`: Token name (default: `Bridged USDC (SKALE Bridge)`)
- `NETWORK_CHAIN_ID`: Chain ID (default: `324705682`)
- `DEFAULT_PRICE`: Price in smallest unit (default: `10000`)
- `MAX_FILE_SIZE`: Max file size in bytes (default: `10485760` = 10MB)
- `FILE_EXPIRATION_DAYS`: Days until expiration (default: `10`)
- `DATABASE_PATH`: SQLite database path (default: `./data/storage.db`)

---

## Client Libraries

### JavaScript/TypeScript Client

A client library is available at `../client` with the following features:

- Automatic x402 payment handling
- Signature generation
- File upload/download
- Type-safe API

Example:
```typescript
import S3StorageClient from './storage-client';

const client = await S3StorageClient.create();

// Upload file
const result = await client.uploadFile('./example.txt');
console.log(`File key: ${result.fileKey}`);
console.log(`Expires: ${result.expiresAt}`);

// Renew file
const renewed = await client.renewFile(result.fileKey);
console.log(`New expiration: ${renewed.newExpires}`);

// List files
const list = await client.listFiles();
console.log(`You have ${list.total} files`);
```

---

## Database Schema

### Files Table

```sql
CREATE TABLE files (
    file_key TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX idx_files_owner ON files(owner_address);
CREATE INDEX idx_files_expires ON files(expires_at);
```

---

## Background Jobs

### Cleanup Job

Runs every hour to remove expired file records from the database.

**Note**: This only removes database records. Actual S3 file cleanup should be configured via S3 lifecycle policies.

---

## Security Considerations

1. **Signature Verification**: All authenticated endpoints verify wallet signatures
2. **Owner-Only Access**: Files can only be accessed by their owner
3. **Payment Verification**: x402 protocol ensures payments are valid
4. **Input Sanitization**: Filenames are sanitized to prevent path traversal
5. **File Size Limits**: Prevents abuse via large uploads

### Recommendations for Production

- Enable HTTPS
- Implement rate limiting
- Configure CORS properly
- Set up S3 lifecycle policies for file cleanup
- Monitor payment settlements
- Implement logging and monitoring
- Use a production-grade database (PostgreSQL)

---

## Changelog

### v1.0.0
- Initial release
- Upload, download, list, delete operations
- File renewal with payment
- x402 payment integration
- 10-day expiration period
- SQLite database storage

---

## Support

For issues and questions, please open an issue on the GitHub repository.

## License

[Add your license information here]
