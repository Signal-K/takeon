FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/pixi-adapter/package.json packages/pixi-adapter/
COPY web/package.json web/
RUN npm install
COPY packages ./packages
COPY web ./web
ARG NEXT_PUBLIC_TAKEON_PB_URL=""
ENV NEXT_PUBLIC_TAKEON_PB_URL=$NEXT_PUBLIC_TAKEON_PB_URL
RUN npm run build -w @takeon/engine && npm run build -w @takeon/pixi && npm run build -w takeon-web

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 3400
CMD ["npm", "run", "start", "-w", "takeon-web"]
