FROM node:20-alpine

# Herramientas para compilar better-sqlite3 (módulo nativo)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
