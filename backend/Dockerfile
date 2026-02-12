# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js/Prisma"

# Node.js/Prisma app lives here
WORKDIR /app

# ----------------------------------------
# Frontend build stage
# ----------------------------------------
FROM node:${NODE_VERSION}-slim AS frontend-build
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend .
ARG VITE_API_BASE=https://alassaad.fly.dev
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# ----------------------------------------
# Backend build stage
# ----------------------------------------
FROM base AS build

# Ensure devDependencies are installed for building
ENV NODE_ENV="development"

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp openssl pkg-config python-is-python3

# Install node modules
COPY backend/package-lock.json backend/package.json ./
RUN npm ci

# Generate Prisma Client
COPY backend/prisma ./prisma
RUN npx prisma generate

# Copy application code
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/scripts ./scripts
COPY backend/src ./src

# Copy the freshly built frontend bundle so Express can serve it
COPY --from=frontend-build /frontend/dist ./public

RUN npm run build

# ----------------------------------------
# Final runtime image
# ----------------------------------------
FROM base

# Set production environment for runtime
ENV NODE_ENV="production"

# Install packages needed for deployment
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y openssl && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Copy built application
COPY --from=build /app /app
# Re-copy Prisma schema + migrations directly from the source tree so release commands
# always have the latest migration files, even if the build stage pruned them.
COPY backend/prisma ./prisma

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]
