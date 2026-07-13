FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV PUBLIC_READONLY=1
ENV STATE_FILE=/tmp/hotspot-radar/state.json

EXPOSE 3000

CMD ["node", "server.js"]
