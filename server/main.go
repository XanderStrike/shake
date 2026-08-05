// Package main is the shake relay+static server.
//
// It replaces HumbleNet's peer-server with a dumb websocket relay: each ioq3
// instance (the host-client or a joining client) opens one websocket and the
// relay forwards datagrams between peers by PeerId. Aliases (lobby names) let
// clients find the host: a host registers an alias, and clients send to a
// "virtual" PeerId derived from a hash of the alias name (high bit set), which
// the relay maps back to the registered host connection.
//
// It also serves the static wasm client assets and an HTTP /lookup/{name}
// endpoint so the page can tell whether a host already exists for a lobby.
//
// Routes:
//   GET  /ws             -> websocket relay
//   GET  /lookup/{name}  -> {"found": bool}
//   GET  /               -> static files (STATIC_DIR, default ./static)
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

const aliasBit uint32 = 0x80000000

// Wire protocol (binary, little-endian). Must match the C++ amalgam.
const (
	msgSendTo         byte = 0x01
	msgRegisterAlias  byte = 0x02
	msgUnregisterAlias byte = 0x03

	msgAssigned     byte = 0x81
	msgRecvFrom     byte = 0x82
	msgAliasResult  byte = 0x83
)

var upgrader = websocket.Upgrader{
	Subprotocols:  []string{"binary"},
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(*http.Request) bool { return true },
}

type Peer struct {
	id   uint32
	conn *websocket.Conn
	send chan []byte
}

type Relay struct {
	mu        sync.Mutex
	peers     map[uint32]*Peer
	aliases   map[string]*Peer
	hashAlias map[uint32]*Peer
	// aliasMap holds the map each lobby's host is running, announced via
	// POST /lookup/{name} so joiners know which pk3 to fetch before connecting.
	aliasMap map[string]string
	nextID   uint32
}

func NewRelay() *Relay {
	return &Relay{
		peers:     make(map[uint32]*Peer),
		aliases:   make(map[string]*Peer),
		hashAlias: make(map[uint32]*Peer),
		aliasMap:  make(map[string]string),
		nextID:    1,
	}
}

func fnv1a(s string) uint32 {
	const offset uint32 = 2166136261
	const prime uint32 = 16777619
	h := offset
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= prime
	}
	return h
}

// register assigns an id, stores the peer, and returns it. Caller must hold mu.
func (r *Relay) register(conn *websocket.Conn) *Peer {
	p := &Peer{id: r.nextID, conn: conn, send: make(chan []byte, 64)}
	r.peers[p.id] = p
	r.nextID++
	return p
}

func (r *Relay) unregister(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// drop any aliases (and their announced map) owned by this peer
	for name, owner := range r.aliases {
		if owner == p {
			delete(r.aliases, name)
			delete(r.hashAlias, fnv1a(name))
			delete(r.aliasMap, name)
		}
	}
	delete(r.peers, p.id)
	close(p.send)
}

// resolve finds the destination peer for a PeerId (real or virtual alias id).
func (r *Relay) resolve(id uint32) *Peer {
	if id&aliasBit != 0 {
		return r.hashAlias[id]
	}
	return r.peers[id]
}

func (r *Relay) handle(p *Peer, msg []byte) {
	if len(msg) < 1 {
		return
	}
	switch msg[0] {
	case msgSendTo:
		if len(msg) < 7 {
			return
		}
		to := binary.LittleEndian.Uint32(msg[1:5])
		ln := int(binary.LittleEndian.Uint16(msg[5:7]))
		if 7+ln > len(msg) {
			ln = len(msg) - 7
		}
		r.mu.Lock()
		dst := r.resolve(to)
		r.mu.Unlock()
		if dst == nil || dst == p {
			return
		}
		out := make([]byte, 7+ln)
		out[0] = msgRecvFrom
		binary.LittleEndian.PutUint32(out[1:5], p.id)
		binary.LittleEndian.PutUint16(out[5:7], uint16(ln))
		copy(out[7:], msg[7:7+ln])
		select {
		case dst.send <- out:
		default:
			// drop if the receiver can't keep up; better than blocking the relay
		}
	case msgRegisterAlias:
		if len(msg) < 2 {
			return
		}
		ln := int(msg[1])
		if 2+ln > len(msg) {
			ln = len(msg) - 2
		}
		name := string(msg[2 : 2+ln])
		r.mu.Lock()
		r.aliases[name] = p
		r.hashAlias[aliasBit|fnv1a(name)] = p
		r.mu.Unlock()
		ack := []byte{msgAliasResult, 1, byte(len(name))}
		ack = append(ack, name...)
		select {
		case p.send <- ack:
		default:
		}
	case msgUnregisterAlias:
		if len(msg) < 2 {
			return
		}
		ln := int(msg[1])
		name := ""
		if ln > 0 && 2+ln <= len(msg) {
			name = string(msg[2 : 2+ln])
		}
		r.mu.Lock()
		if name == "" {
			for n, owner := range r.aliases {
				if owner == p {
					delete(r.aliases, n)
					delete(r.hashAlias, aliasBit|fnv1a(n))
				}
			}
		} else if r.aliases[name] == p {
			delete(r.aliases, name)
			delete(r.hashAlias, aliasBit|fnv1a(name))
		}
		r.mu.Unlock()
	}
}

func (r *Relay) serveWS(w http.ResponseWriter, req *http.Request) {
	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	r.mu.Lock()
	p := r.register(conn)
	assigned := []byte{msgAssigned, 0, 0, 0, 0}
	binary.LittleEndian.PutUint32(assigned[1:5], p.id)
	r.mu.Unlock()

	log.Printf("peer %d connected from %s", p.id, req.RemoteAddr)

	// writer goroutine
	go func() {
		defer conn.Close()
		for pkt := range p.send {
			if err := conn.WriteMessage(websocket.BinaryMessage, pkt); err != nil {
				return
			}
		}
	}()
	// send assigned id first
	p.send <- assigned

	// reader
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) && !errors.Is(err, websocket.ErrCloseSent) {
				log.Printf("peer %d read: %v", p.id, err)
			}
			break
		}
		r.handle(p, data)
	}
	r.unregister(p)
	log.Printf("peer %d disconnected", p.id)
}

func (r *Relay) serveLookup(w http.ResponseWriter, req *http.Request) {
	name := strings.TrimPrefix(req.URL.Path, "/lookup/")
	name = strings.Trim(name, "/")
	if name == "" {
		http.Error(w, "missing name", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodGet:
		r.mu.Lock()
		found := r.aliases[name] != nil
		mp := r.aliasMap[name]
		r.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Found bool   `json:"found"`
			Map   string `json:"map"`
		}{Found: found, Map: mp})

	case http.MethodPost:
		// A host announces which map its lobby is running so joiners can fetch
		// the right pk3 before connecting. Stored by lobby name; cleared when the
		// host peer disconnects (see unregister).
		var body struct {
			Map string `json:"map"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		r.mu.Lock()
		r.aliasMap[name] = body.Map
		r.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			OK bool `json:"ok"`
		}{OK: true})

	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	staticDir := flag.String("static", getenv("STATIC_DIR", "./static"), "directory of static client assets")
	flag.Parse()

	relay := NewRelay()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", relay.serveWS)
	mux.HandleFunc("/lookup/", relay.serveLookup)

	if *staticDir != "" {
		fs := http.FileServer(http.Dir(*staticDir))
		mux.Handle("/", fs)
	}

	log.Printf("shake listening on :%s (static=%s, ws=/ws, lookup=/lookup/{name})", port, *staticDir)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
