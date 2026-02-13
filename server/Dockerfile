# Dockerfile for nova-s3-server
FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install --production --include=dev

# Copy all source code
COPY . ./

# Expose port (default 3000)
EXPOSE 3000

# Set environment variables (can be overridden)
ENV NODE_ENV=production
ENV IN_DOCKER=true

# Start server
CMD ["npm", "run", "dev"]
