# shake - single container that serves the wasm client and the websocket relay.
#
# Static assets live in client/ and the Go relay/server in server/. The Q3 demo
# installer (from which the page extracts pak0.pk3) is downloaded at build time
# if it isn't already present in client/.

# --- build the Go server ---
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/shake .

# --- runtime ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget

COPY --from=build /out/shake /usr/local/bin/shake
COPY client/ /static/

# The page fetches ./linuxq3ademo-1.11-6.x86.gz.sh and extracts pak0.pk3 from it.
RUN if [ ! -f /static/linuxq3ademo-1.11-6.x86.gz.sh ]; then \
      wget -q -O /static/linuxq3ademo-1.11-6.x86.gz.sh \
        'https://archive.org/download/tucows_286139_Quake_III_Arena/linuxq3ademo-1.11-6.x86.gz.zip/linuxq3ademo-1.11-6.x86.gz.sh' ; \
    fi

ENV STATIC_DIR=/static PORT=8080
EXPOSE 8080
CMD ["shake"]
