############################
# 1 – Builder stage
############################
FROM node:18-alpine AS builder

# work in /app
WORKDIR /app

# first, install only production deps
COPY package*.json ./
RUN npm ci --omit=dev          # installs deps *without* devDependencies

# now copy the source
COPY . .

############################
# 2 – Runtime stage
############################
FROM node:18-alpine

# the official image already has a non-root user called “node” (uid = 1000)
USER node

WORKDIR /app

# copy app + node_modules from the builder *and* give ownership to “node”
COPY --chown=node:node --from=builder /app ./

EXPOSE 4000
CMD ["node", "src/index.js"]
