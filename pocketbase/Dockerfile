FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /takeon .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /takeon /app/takeon
COPY pb_migrations /app/pb_migrations
EXPOSE 8094
CMD ["/app/takeon", "serve", "--http", "0.0.0.0:8094"]
