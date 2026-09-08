FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /data
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
