FROM node:20-alpine AS base
RUN apk add --no-cache git

WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/

RUN npm ci --workspace=@trailmap/worker --workspace=@trailmap/scanner

WORKDIR /app/apps/worker
RUN npm run build

CMD ["node", "dist/index.js"]
