// QuickNet: matchmaking + packet relay over Quick's WebSocket rooms (quick.socket).
//
// The wasm engine reaches this through the net_quick.c bridge as globalThis.QNet. Every tab
// in a room is a peer with a random 32-bit id; the peer with the lowest id hosts the Quake
// server and everyone else connects to it. Relayed packets are broadcast to the whole room,
// so each peer keeps only the ones addressed to it.

function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

export const QNet = {
    ready: false,
    myPeerId: (crypto.getRandomValues(new Uint32Array(1))[0] % 0x7ffffffe) + 1,
    room: null,
    incoming: [],
    state: null,

    async init(name) {
        this.state = { peerId: this.myPeerId };
        const room = this.room = quick.socket.room(name);
        room.on("q3", (msg) => {
            if (msg.to !== this.myPeerId || msg.from === this.myPeerId) return;
            this.incoming.push({ peer: msg.from >>> 0, data: base64ToBytes(msg.d) });
        });
        let firstReady;
        const readyOnce = new Promise((r) => (firstReady = r));
        // Re-advertise our presence on join and every reconnect.
        room.on("ready", () => { room.updateUserState(this.state); firstReady(); });
        await room.join();
        await readyOnce;
        this.ready = true;
    },

    // Called from wasm (net_quick.c).
    send(peer, bytes) {
        this.room.emit("q3", { to: peer >>> 0, from: this.myPeerId, d: bytesToBase64(bytes) });
    },
    recv() { return this.incoming.shift(); },
    pending() { return this.incoming.length > 0; },

    // Everyone in the room (deduped, including ourselves with our freshest state).
    peers() {
        const byId = new Map([[this.myPeerId, { peerId: this.myPeerId, role: this.state.role, map: this.state.map }]]);
        for (const u of this.room.users.values()) {
            const s = u.state;
            if (s && s.peerId && (s.peerId >>> 0) !== this.myPeerId)
                byId.set(s.peerId >>> 0, { peerId: s.peerId >>> 0, role: s.role, map: s.map });
        }
        return [...byId.values()];
    },

    // Whoever advertises the server role (or, before anyone has, the lowest peer id present)
    // hosts; everyone else connects to them. Returns the host's peer id, or null if that's us.
    electHost(map) {
        const peers = this.peers();
        const servers = peers.filter((p) => p.role === "server").map((p) => p.peerId);
        const host = servers.length ? Math.min(...servers)
                                    : Math.min(...peers.map((p) => p.peerId));
        if (host === this.myPeerId) {
            this.becomeServer(map);
            return null;
        }
        return host;
    },

    // Look up an advertised peer (e.g. the host, to read the map it's running).
    peer(id) {
        return this.peers().find((p) => p.peerId === id);
    },

    // Claim the game-server role so late joiners connect here instead of hosting again, and
    // advertise the map so they can load the same assets.
    becomeServer(map) {
        this.state.role = "server";
        this.state.map = map;
        this.room.updateUserState(this.state);
    },
};

window.QNet = QNet;
