# ----------  Builder stage ----------
    FROM node:18-alpine AS builder
    WORKDIR /app
    COPY package*.json ./
    RUN npm ci --omit=dev      # install prod deps only
    COPY . .
    
    # ----------  Runtime stage ----------
    FROM node:18-alpine
    WORKDIR /app
    # copy only the compiled app & node_modules from builder
    COPY --from=builder /app ./
    EXPOSE 4000
    USER node                  # drop root
    CMD ["node", "src/index.js"]
     