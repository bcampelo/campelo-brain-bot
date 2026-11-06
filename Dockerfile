FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
VOLUME ["/app/auth"]
CMD ["node", "src/index.js"]
