# Build stage
FROM node:24-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-slim AS runner

WORKDIR /app

# Only copy built files and production dependencies
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Standard MCP servers usually run on stdio
ENTRYPOINT ["node", "dist/index.js"]
