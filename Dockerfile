# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install pnpm and dependencies needed for building
RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@9.12.0 --activate

# Create app directory with correct permissions before switching user
RUN mkdir -p /app && chown 1000:1000 /app

# Switch to the non-root 'node' user provided by the alpine image (UID 1000)
USER 1000

WORKDIR /app

# Copy only dependency files to leverage layer caching
COPY --chown=1000:1000 package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY --chown=1000:1000 . .

# Build the frontend and backend
RUN pnpm run build

# Stage 2: Production runtime stage
FROM node:20-alpine AS runner

# Install pnpm for installing production dependencies
RUN corepack enable \
    && corepack prepare pnpm@9.12.0 --activate

# Create app directory with correct permissions before switching user
RUN mkdir -p /app && chown 1000:1000 /app

# Switch to the non-root 'node' user (UID 1000)
USER 1000

WORKDIR /app

# Set Node environment to production
ENV NODE_ENV=production
ENV PORT=5000

# Copy dependency files and build outputs from the builder stage
COPY --chown=1000:1000 --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --chown=1000:1000 --from=builder /app/dist ./dist

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Expose port 5000 as configured in the project
EXPOSE 5000

# Start the Node.js application
CMD ["pnpm", "start"]
