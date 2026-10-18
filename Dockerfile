FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
