# Quick Start Guide - Nova S3 CLI

Get started with the Nova S3 command-line client in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- An Ethereum wallet with some USDC on SKALE Europa Hub
- Nova S3 Server running (or access to a hosted instance)
- payment token(USDC)
  - [BASE SEPOLIA_USDC FAUCET](https://faucet.circle.com/)
  - [bridge USDC from BASE SEPOLIA to SKALE SEPOLIA](https://base-sepolia.skalenodes.com/bridge?from=mainnet&to=jubilant-horrible-ancha&token=usdc&type=erc20)


## Setup (1 minute)

### 1. Install Dependencies

```bash
cd nova-s3/client
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your private key:

```bash
# Required
PRIVATE_KEY=0x1234567890abcdef...

# Optional (if using different server)
SERVER_URL=http://localhost:3000
```

### 3. Build and Link

```bash
npm run build
npm link
```

## Basic Usage (2 minutes)

### Upload Your First File

```bash
nova-s3 upload ./example.txt
```

**Output:**
```
✔ Connected as 0x1234...
✔ File uploaded successfully!

📦 File Details:
  File Key:  0x1234.../1707825600000-example.txt
  Size:      1.2 KB
  Expires:   2/23/2025, 10:00:00 AM (9d 23h)
```

💡 **Tip:** Copy the file key - you'll need it to download the file!

### List Your Files

```bash
nova-s3 list
```

### Download a File

```bash
nova-s3 get <filekey>
```

### Renew Expiration

```bash
nova-s3 renew <filekey>
```

## Common Commands

| Command | Description | Example |
|---------|-------------|---------|
| `nova-s3 upload <file>` | Upload a file | `nova-s3 upload photo.jpg` |
| `nova-s3 list` | List all your files | `nova-s3 list` |
| `nova-s3 get <key>` | Download a file | `nova-s3 get 0x.../file.txt` |
| `nova-s3 info <key>` | Get file details | `nova-s3 info 0x.../file.txt` |
| `nova-s3 renew <key>` | Add 10 days | `nova-s3 renew 0x.../file.txt` |
| `nova-s3 delete <key>` | Delete a file | `nova-s3 delete 0x.../file.txt` |
| `nova-s3 wallet` | Show wallet info | `nova-s3 wallet` |
| `nova-s3 --help` | Show help | `nova-s3 --help` |

## Example Workflow

```bash
# 1. Upload a document
nova-s3 upload ./important-document.pdf

# Output shows file key: 0x1234.../1707825600000-important-document.pdf

# 2. List all files to see expiration
nova-s3 list

# 3. Get file info
nova-s3 info 0x1234.../1707825600000-important-document.pdf

# 4. Download to different location
nova-s3 get 0x1234.../1707825600000-important-document.pdf ./backup/doc.pdf

# 5. Renew before it expires
nova-s3 renew 0x1234.../1707825600000-important-document.pdf

# 6. Delete when no longer needed
nova-s3 delete 0x1234.../1707825600000-important-document.pdf
```

## Running Without Installation

If you don't want to install globally:

```bash
# Run CLI directly with npm
npm run cli -- upload ./file.txt
npm run cli -- list
npm run cli -- get <filekey>
```

## Troubleshooting

### "Command not found: nova-s3"

```bash
# Re-run npm link
npm link

# Or run directly
npm run cli -- <command>
```

### "Missing required environment variable: PRIVATE_KEY"

```bash
# Make sure .env file exists and has PRIVATE_KEY set
cat .env | grep PRIVATE_KEY

# If missing, copy from example
cp .env.example .env
# Then edit .env with your private key
```

### "Payment required (402)"

This is normal! The first upload/renewal requires payment:

```
Payment required (402), processing payment...
Payment signed, sending...
Payment settled, tx: 0xabcd...
✔ Operation completed successfully!
```

Your wallet will automatically sign and send the payment. Make sure you have enough USDC.

### "Failed to initialize client"

Check that:
1. Server is running: `curl http://localhost:3000/health`
2. SERVER_URL in .env is correct
3. Your private key is valid (starts with 0x)

## Tips for Success

✅ **DO:**
- Keep your private key secure
- Save file keys somewhere safe
- Renew important files before they expire
- Use `nova-s3 list` regularly to check expirations

❌ **DON'T:**
- Commit .env file to git
- Share your private key
- Forget to renew important files
- Lose your file keys (you won't be able to download!)

## What's Next?

- Read the full CLI documentation: [CLI.md](./CLI.md)
- Check out the API documentation: [../server/API.md](../server/API.md)
- Try the AI agent mode: `npm run start`

## Payment Information

- **Upload Cost**: 0.01 USDC per upload (configurable)
  - ⚠️ **Every upload requires payment**
  - Each file you upload costs the configured price
- **Renewal Cost**: 0.01 USDC per renewal
  - ⚠️ **Every renewal requires payment**
  - Each time you extend expiration, you pay the configured price
- **Expiration**: 10 days (adds 10 days per renewal)
- **Network**: SKALE Europa Hub (fast & cheap!)

## Need Help?

- Run `nova-s3 --help` for command help
- Run `nova-s3 <command> --help` for command-specific help
- Check [CLI.md](./CLI.md) for detailed documentation
- Open an issue on GitHub

---

**Happy storing! 🚀**
