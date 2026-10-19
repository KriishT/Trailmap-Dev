FROM node:20-alpine AS base
RUN apk add --no-cache git

WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/

RUN npm ci \
    --workspace=@trailmap/worker \
    --workspace=@trailmap/pipeline \
    --workspace=@trailmap/scanner \
    --workspace=@trailmap/graph \
    --workspace=@trailmap/eslint-config \
    --workspace=@trailmap/typescript-config

# Build the shared packages first, then the worker.
RUN npm run build --workspace=@trailmap/graph \
 && npm run build --workspace=@trailmap/scanner \
 && npm run build --workspace=@trailmap/pipeline \
 && npm run build --workspace=@trailmap/worker

WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
