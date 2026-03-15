# Stage 1: Build stage
FROM node:20-alpine AS builder

# Set working directory and create it with correct ownership
RUN mkdir -p /app && chown 1000:1000 /app

# Install pnpm and dependencies as root before dropping privileges
RUN npm install -g pnpm@9.12.0

# Switch to the non-root 'node' user provided by the alpine image (UID 1000)
USER 1000

WORKDIR /app

# Copy only dependency files to leverage layer caching
COPY --chown=1000:1000 package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code explicitly to avoid copying secrets or unnecessary files
COPY --chown=1000:1000 client/ ./client/
COPY --chown=1000:1000 server/ ./server/
COPY --chown=1000:1000 shared/ ./shared/
COPY --chown=1000:1000 script/ ./script/
COPY --chown=1000:1000 drizzle.config.ts components.json postcss.config.js tailwind.config.ts tsconfig.json vite.config.ts ./

# Build the frontend and backend
RUN pnpm run build

# Stage 2: Production runtime stage
FROM node:20-alpine AS runner

# Create app directory with correct permissions before switching user
RUN mkdir -p /app && chown 1000:1000 /app

# Install pnpm for installing production dependencies as root
RUN npm install -g pnpm@9.12.0

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
