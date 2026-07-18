FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -F db db:generate && pnpm build
CMD ["pnpm", "-F", "worker", "start"]
