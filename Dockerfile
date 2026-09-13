FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm ci
COPY . .
ARG APP=api-gateway
RUN npx nest build $APP

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ARG APP=api-gateway
ENV APP=$APP
CMD ["sh", "-c", "node dist/apps/$APP/main.js"]
