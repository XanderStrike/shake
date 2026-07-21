# shake

host your own web-based quake lan party.

## running

the client is a static site that runs multiplayer over [Quick](https://quick.shopify.io)
WebSocket rooms (`quick.socket`), so it deploys to Quick with no separate matchmaking
server:

```sh
quick serve client          # local dev
quick deploy client q3a     # deploy
```

to keep things simple every visitor will join the same lobby by default, but if you want a private game you can append `?server=whatever` and share that link

don't have friends? no problem, activate bots by appending `?lonely`

want to play a different map from the demo? append `?map=q3dm7` (options are `q3dm1`, `q3dm7`, `q3dm17`, `q3tourney2`)

## multiplayer

matchmaking and packet relay run over a `quick.socket` room named after the `?server`
param. every tab is a peer with a random id; the lowest-id peer in the room hosts the
quake server and everyone else connects to it. see `client/qnet.js` for the browser side
and `engine/BUILD.md` for the engine transport (`net_quick.c`, which replaces HumbleNet).

## disclaimer

this is a very minimal scrape and remix of the extremely cool https://thelongestyard.link/ who's source can be found [here](https://github.com/jdarpinian/ioq3), with the HumbleNet matchmaking swapped out for Quick.

inspired by how i've previously used the now-abandoned [quake-kube](https://github.com/criticalstack/quake-kube)