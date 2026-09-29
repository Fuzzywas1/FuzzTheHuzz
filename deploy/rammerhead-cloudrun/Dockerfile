FROM node:22-bookworm-slim AS build
WORKDIR /app
ADD https://codeload.github.com/binary-person/rammerhead/tar.gz/ee5fbb7837f5fe752c4b82c18184f42449678d5b /tmp/upstream.tgz
RUN tar -xzf /tmp/upstream.tgz --strip-components=1 -C /app
COPY package.json package-lock.json ./
COPY guard.cjs egress.cjs test.cjs patch-build.cjs ./
RUN node patch-build.cjs && npm ci --ignore-scripts && npm test && npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node config.cjs ./config.js
COPY --chown=node:node start.cjs guard.cjs egress.cjs ./
USER node
EXPOSE 8080
CMD ["node", "--max-old-space-size=640", "start.cjs"]
