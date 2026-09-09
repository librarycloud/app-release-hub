FROM node:20-alpine

# Install bsdiff for incremental patch generation and build tools for native addons (better-sqlite3)
RUN apk add --no-cache bsdiff python3 make g++

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000
CMD ["node", "src/app.js"]
