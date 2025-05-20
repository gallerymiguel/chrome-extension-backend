# 1. Use Node.js LTS base image
FROM node:18

# 2. Create app directory inside container
WORKDIR /usr/src/app

# 3. Copy dependency files first (for better caching)
COPY package*.json ./

# 4. Install dependencies
RUN npm install

# 5. Copy all other source code
COPY . .

# 6. Expose the port your backend listens on (adjust if needed)
EXPOSE 4000

# 7. Start the server
CMD ["node", "src/index.js"]
