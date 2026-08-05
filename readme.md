# shake

host your own web-based quake lan party.

## running

download the [docker-compose.yml](https://raw.githubusercontent.com/xanderstrike/shake/main/docker-compose.yml) and run `docker compose up`.

visit <server-ip>:8081 and play.

to keep things simple every visitor will join the same lobby by default, but if you want a private game you can append `?server=whatever` and share that link

don't have friends? no problem, activate bots by appending `?lonely`

want to play a different map from the demo? append `?map=q3dm7` (options are `q3dm1`, `q3dm7`, `q3dm17`, `q3tourney2`)

## architecture

everything runs in one container:

- a small Go server ([`server/main.go`](server/main.go)) that
  - serves the static wasm client from `/`
  - exposes a websocket **relay** at `/ws`
  - answers `GET /lookup/{name}` with `{"found": bool}` so a new visitor knows whether a host already exists for a lobby
- the first visitor to a lobby becomes the host (the wasm runs the quake server in-process and registers the lobby name); everyone else connects to it through the relay

the relay just forwards datagrams between connected peers by `PeerId` — no WebRTC, no P2P, no signaling. this replaced the old [HumbleNet](https://github.com/jdarpinian/HumbleNet) peer-server entirely.

because the relay is on a path (`/ws`) instead of its own port, the whole thing reverse-proxies cleanly: point your proxy at the container and `/`, `/ws`, and `/lookup/*` all come along for the ride.

## rebuilding the engine

the wasm client in [`client/`](client/) is built from the ioquake3 fork at [`../ioq3`](https://github.com/XanderStrike/ioq3) (which contains the relay client in `code/humblenet/humblenet_asmjs_amalgam.cpp`). to rebuild after engine changes:

```
cd ../ioq3
podman run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.58 emmake make -j5
cp build/release-emscripten-wasm32/ioquake3_opengl2.wasm32.{js,wasm} ../shake/client/
```

## disclaimer

this is a very minimal scrape and remix of the extremely cool https://thelongestyard.link/ who's source can be found [here](https://github.com/jdarpinian/ioq3)

inspired by how i've previously used the now-abandoned [quake-kube](https://github.com/criticalstack/quake-kube)
