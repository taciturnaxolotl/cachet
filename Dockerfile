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

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# ENTRYPOINT (not CMD) so the app still starts on platforms that launch the
# image with no args -- an empty CMD would otherwise fall through to the base
# image's own `CMD ["/usr/local/bin/bun"]`, which just prints bun's help text.
ENTRYPOINT ["bun", "run", "src/index.ts"]
