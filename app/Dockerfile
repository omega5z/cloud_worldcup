FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

USER node

EXPOSE 3000

CMD ["node", "main.js"]
