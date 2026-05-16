FROM oven/bun:1
WORKDIR /app

# Ensure package.json points to the protocol git repo:
# "cell-mesh-protocol-1": "git+https://github.com/Leif-Rydenfalk/cell-protocol-example-1.git"
COPY package.json bun.lockb ./
RUN bun install --production

COPY . .

ENV NODE_ENV=production
# Map the Hetzner Volume here
VOLUME ["/app/data"]

CMD ["bun", "run", "index.ts"]