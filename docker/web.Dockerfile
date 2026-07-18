FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -F db db:generate && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build REDIS_URL=redis://127.0.0.1:6379 CREDENTIALS_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= pnpm -F web build
CMD ["pnpm", "-F", "web", "start"]
