# Build Stage
FROM ubuntu:20.04 AS build

# Don't ask for help configuring stuff
ARG DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    make \
    git \
    zlib1g-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clone the HumbleNet repository
RUN git clone https://github.com/XanderStrike/HumbleNet.git /opt/HumbleNet

# Update all submodules
WORKDIR /opt/HumbleNet
RUN git submodule update --init --recursive

# Build the peer-server binary
RUN cmake .
RUN make peer-server


# Run Stage
FROM ubuntu:24.04

WORKDIR /app

# Copy the peer-server binary from the build stage
COPY --from=build /opt/HumbleNet/peer-server.bin.x86_64 /app/peer-server

EXPOSE 8080

# Set the entrypoint to run the peer-server
ENTRYPOINT ["/app/peer-server"]
