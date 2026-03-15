# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install pnpm and dependencies needed for building
RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy only dependency files to leverage layer caching
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Build the frontend and backend
# (Ensure script/build.ts is not ignored in .dockerignore if it's needed)
RUN pnpm run build

# Stage 2: Production runtime stage
FROM node:20-alpine AS runner

# Install pnpm for installing production dependencies
RUN corepack enable \
    && corepack prepare pnpm@latest --activate

WORKDIR /app

# Set Node environment to production
ENV NODE_ENV=production

# Copy dependency files and build outputs from the builder stage
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Expose port 5000 as configured in the project
EXPOSE 5000

# Start the Node.js application
CMD ["pnpm", "start"]
