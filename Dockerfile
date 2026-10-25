# syntax=docker/dockerfile:1

# Ada builds the client (React + Vite) and runs the server straight from its
# TypeScript source with vite-node: there is no server build step. Because of
# that, the runtime image keeps devDependencies (vite-node itself is one, a
# transitive dependency of vitest) and the server/game-core/protocol source
# trees, not just compiled output. See docs/DECISIONS.md.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/game-core ./packages/game-core
COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server
COPY packages/client/package.json ./packages/client/package.json
COPY --from=build /app/packages/client/dist ./packages/client/dist

EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@ada/server"]
