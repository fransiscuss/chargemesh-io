FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
EXPOSE 9000
CMD ["pnpm", "mock-csms"]
