# Building the engine

`client/ioquake3_opengl2.wasm32.{js,wasm}` is [ioquake3](https://github.com/jdarpinian/ioq3)
(the web port behind [thelongestyard.link](https://thelongestyard.link)) compiled to
WebAssembly with Emscripten, with its networking pointed at Quick instead of HumbleNet.

## What changed

Upstream routes multiplayer through HumbleNet: a WebRTC data-channel mesh with a separate
signalling/relay "peer server". We replace that whole layer with `net_quick.c`, which relays
packets over a [Quick WebSocket room](https://quick.shopify.io) (`quick.socket`).

The engine still makes ordinary BSD socket calls; `net_quick.c` redirects the single UDP
socket it opens into `globalThis.QNet` (see `client/qnet.js`). Each tab is a peer with a
random 32-bit id carried in the `sockaddr_in` address. Matchmaking is presence-based: the
lowest-id peer in a room hosts the Quake server and everyone else connects to `peer_<id>.qnet`.

This deletes the ~360KB HumbleNet amalgam and the peer server entirely.

## Reproducing the build

Emscripten 3.1.58 (matches upstream CI). Docker/Podman avoids toolchain setup:

```sh
git clone --depth 1 https://github.com/jdarpinian/ioq3.git
cd ioq3

# Apply the QuickNet transport.
cp ../engine/net_quick.c code/qcommon/net_quick.c
git apply ../engine/quicknet.patch            # net_ip.c include + Makefile (USE_QUICKNET)
rm -rf code/humblenet code/qcommon/net_humblenet.c

# BUILD_SERVER=0: shake only ships the client; the host runs a listen server in-tab.
podman run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.58 \
  emmake make release BUILD_SERVER=0 -j"$(nproc)"

cp build/release-emscripten-wasm32/ioquake3_opengl2.wasm32.js  ../client/
cp build/release-emscripten-wasm32/ioquake3_opengl2.wasm32.wasm ../client/
```
