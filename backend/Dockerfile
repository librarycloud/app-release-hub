FROM node:20-alpine

# Install bsdiff for incremental patch generation
RUN apk add --no-cache bsdiff

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000
CMD ["node", "src/app.js"]
