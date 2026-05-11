# shake

host your own web-based quake lan party.

## running

Clone the repository (or download `docker-compose.yml` and `Caddyfile`) and run:

```bash
# 1. Find your LAN IP
hostname -I

# 2. Put that IP in Caddyfile (replace 192.168.1.X)
#    For a public domain, replace the IP with your domain name and
#    change "tls internal" to "tls" for automatic Let's Encrypt certs.

# 3. Start everything
docker compose up -d
```

Then visit `https://<server-ip>` from any device on the same network.

### Trusting the local certificate (one-time per device)

Because the setup uses a self-signed certificate (`tls internal` in the
Caddyfile), browsers will show a warning until you install the local root CA:

```bash
# On the host machine running Docker
docker exec caddy caddy trust
```

Or copy the root certificate out of the `caddy_data` volume
(`/data/caddy/pki/authorities/local/root.crt`) and import it into your OS /
browser trust store.

### Game URLs

| URL | What it opens |
|-----|---------------|
| `https://<server-ip>/` | Game client |
| `https://<server-ip>/peer*` | Peer server (forwarded to `shake-server:8080`) |

To keep things simple every visitor will join the same lobby by default, but if
you want a private game you can append `?server=whatever` and share that link.

Don't have friends? No problem — activate bots by appending `?lonely`.

Want to play a different map from the demo? Append `?map=q3dm7`
(options are `q3dm1`, `q3dm7`, `q3dm17`, `q3tourney2`).

### Understanding the nginx startup logs

When the `shake-dev` container starts you will see lines like:

```
/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration
10-listen-on-ipv6-by-default.sh: info: /etc/nginx/conf.d/default.conf differs from the packaged version
Configuration complete; ready for start up
```

These are **expected and harmless**. The nginx Docker image ships with an
`/docker-entrypoint.d/` directory of initialization scripts that run before
nginx starts. The script `10-listen-on-ipv6-by-default.sh` checks whether
`/etc/nginx/conf.d/default.conf` matches the image's built-in default; because
we mount our own `client/nginx.conf` there, it detects a difference and logs
the message — then simply moves on. The final "Configuration complete; ready
for start up" line confirms nginx started successfully.

## disclaimer

this is a very minimal scrape and remix of the extremely cool https://thelongestyard.link/ who's source can be found [here](https://github.com/jdarpinian/ioq3) and [here](https://github.com/jdarpinian/HumbleNet)

inspired by how i've previously used the now-abandoned [quake-kube](https://github.com/criticalstack/quake-kube)