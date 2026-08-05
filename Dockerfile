# syntax = docker/dockerfile:1

ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

WORKDIR /app
ENV NODE_ENV="production"


# --- build stage: install dependencies -------------------------------------
FROM base AS build

# Nothing here compiles native code (express, ws and dotenv are pure JS), so the
# build toolchain the generator installed is not needed.
COPY package-lock.json package.json ./

# `--omit=dev` is safe: @hyperbeam/web is a runtime dependency because the
# server hands its dist bundle straight to the browser at /vendor/hyperbeam.js.
RUN npm ci --omit=dev

COPY . .


# --- final image ------------------------------------------------------------
FROM base

COPY --from=build /app /app

EXPOSE 8080

# Run node directly rather than through npm: as PID 1 it receives the SIGINT
# Fly sends when stopping the machine, which is what triggers the shutdown
# handler that terminates the Hyperbeam session. Behind `npm run start` the
# signal would not reach it and the virtual computer would keep billing.
CMD [ "node", "server/index.js" ]
