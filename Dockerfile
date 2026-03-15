# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install build dependencies and pnpm
RUN npm install -g pnpm@9.12.0

WORKDIR /app

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Copy scripts needed for postinstall
COPY script/ ./script/

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code explicitly to avoid COPY . . security hotspots
COPY client/ ./client/
COPY server/ ./server/
COPY shared/ ./shared/
COPY tsconfig.json vite.config.ts components.json tailwind.config.ts postcss.config.js drizzle.config.ts ./

# Build the frontend and backend
RUN pnpm run build

# Stage 2: Production runtime stage
FROM node:20-alpine AS runner

# Install pnpm for production dependencies
RUN npm install -g pnpm@9.12.0

WORKDIR /app

# Set Node environment to production
ENV NODE_ENV=production
ENV PORT=5000

# Copy dependency files and build outputs from the builder stage
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/script ./script

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Drop privileges to non-root user (UID 1000) for security
USER 1000

# Expose port 5000 as configured in the project
EXPOSE 5000

# Start the Node.js application directly
CMD ["node", "dist/index.js"]
