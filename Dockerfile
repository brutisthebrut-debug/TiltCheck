FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

# Vite embeds public browser configuration at build time. Railway exposes
# service variables to Docker builds; other hosts can pass this as a build arg.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG BASE_PATH=/
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV BASE_PATH=$BASE_PATH
ENV NODE_ENV=production

RUN pnpm build

EXPOSE 3000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
