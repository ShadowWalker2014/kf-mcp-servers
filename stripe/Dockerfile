FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV TRANSPORT_TYPE=http
ENV PORT=3300

EXPOSE 3300

CMD ["npx", "tsx", "src/index.ts"]
