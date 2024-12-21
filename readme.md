# shake

host your own web-based quake lan party.

## running

download the [docker-compose.yml](https://raw.githubusercontent.com/xanderstrike/shake/main/docker-compose.yml) and run `docker compose up`.

visit <server-ip>:8081 and play.

to keep things simple every visitor will join the same lobby by default, but if you want a private game you can append `?server=whatever` and share that link

don't have friends? no problem, activate bots by appending `?lonely`

## disclaimer

this is a very minimal scrape and remix of the extremely cool https://thelongestyard.link/ who's source can be found [here](https://github.com/jdarpinian/ioq3) and [here](https://github.com/jdarpinian/HumbleNet)

inspired by how i've previously used the now-abandoned [quake-kube](https://github.com/criticalstack/quake-kube)