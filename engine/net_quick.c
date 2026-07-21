//
//  net_quick.c
//
//  Browser networking for the Emscripten build. Matchmaking and packet relay both run
//  over Quick's WebSocket rooms (quick.socket) instead of a WebRTC signalling/relay peer
//  server. The page's script.js joins the room and exposes globalThis.QNet; this file is
//  the bridge between the engine's C socket calls and that object.
//
//  The engine keeps using ordinary BSD socket calls. The macros at the bottom redirect the
//  single UDP socket the engine opens into QNet, so the rest of net_ip.c is untouched. Each
//  browser tab is identified by a random 32-bit PeerId carried in the sockaddr_in address,
//  exactly where an IPv4 address would normally sit.
//

#include <emscripten.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <arpa/inet.h>
#include <netdb.h>

typedef unsigned int PeerId;

//=============================================================================
// Bridge to globalThis.QNet (defined in the page's script.js).
//=============================================================================

// True once the room has been joined and a PeerId assigned.
EM_JS(int, qnet_ready, (void), {
	return (globalThis.QNet && globalThis.QNet.ready) ? 1 : 0;
});

// This tab's PeerId, or 0 before the room is joined.
EM_JS(unsigned int, qnet_my_peer, (void), {
	return globalThis.QNet ? (globalThis.QNet.myPeerId >>> 0) : 0;
});

// Relay a packet to another tab.
EM_JS(void, qnet_send, (const void *data, int length, unsigned int peer), {
	globalThis.QNet.send(peer >>> 0, HEAPU8.subarray(data, data + length));
});

// Pop the next packet addressed to this tab, writing the sender's PeerId to *peer.
// Returns the packet length, or 0 if nothing is queued.
EM_JS(int, qnet_recv, (void *data, int maxlength, unsigned int *peer), {
	const pkt = globalThis.QNet.recv();
	if (!pkt) return 0;
	const n = Math.min(pkt.data.length, maxlength);
	HEAPU8.set(pkt.data.subarray(0, n), data);
	HEAPU32[peer >>> 2] = pkt.peer >>> 0;
	return n;
});

// True if at least one packet is waiting.
EM_JS(int, qnet_pending, (void), {
	return (globalThis.QNet && globalThis.QNet.pending()) ? 1 : 0;
});

//=============================================================================
// Socket shim: redirect the engine's UDP socket into QNet.
//=============================================================================

static SOCKET g_qnet_socket = INVALID_SOCKET;

#define QNET_SUFFIX     ".qnet"
#define QNET_SUFFIX_LEN 5

static int qnet_is_host(const char *host) {
	size_t len = strlen(host);
	return len > QNET_SUFFIX_LEN &&
		strcasecmp(host + len - QNET_SUFFIX_LEN, QNET_SUFFIX) == 0;
}

// getaddrinfo/gethostbyname hand back this statically allocated result for QNet hosts.
// The unusual ai_flags value marks it so qnet_freeaddrinfo leaves it alone.
#define QNET_ADDRINFO_MARKER 0x40000000

static struct addrinfo *qnet_make_addrinfo(PeerId peer) {
	static struct addrinfo info;
	static struct sockaddr_in addr;

	memset(&info, 0, sizeof(info));
	memset(&addr, 0, sizeof(addr));

	addr.sin_family = AF_INET;
	addr.sin_addr.s_addr = htonl(peer);

	info.ai_flags = QNET_ADDRINFO_MARKER;
	info.ai_family = AF_INET;
	info.ai_socktype = SOCK_DGRAM;
	info.ai_addrlen = sizeof(addr);
	info.ai_addr = (struct sockaddr *)&addr;
	return &info;
}

static int qnet_socket(int af, int type, int protocol) {
	int s = socket(af, type, protocol);
	// The engine opens exactly one UDP socket; adopt it as the relay endpoint.
	if (g_qnet_socket == INVALID_SOCKET && af == PF_INET && type == SOCK_DGRAM)
		g_qnet_socket = s;
	return s;
}

static int qnet_recvfrom(int s, void *buf, int len, int flags, struct sockaddr *addr, uint32_t *addrlen) {
	struct sockaddr_in *in;
	PeerId peer = 0;
	int ret;

	if (s != g_qnet_socket || s == INVALID_SOCKET)
		return recvfrom(s, buf, len, flags, addr, addrlen);

	ret = qnet_recv(buf, len, &peer);

	in = (struct sockaddr_in *)addr;
	in->sin_family = AF_INET;
	in->sin_port = 0; // ports are unused; the client adopts the server's address on connect
	in->sin_addr.s_addr = htonl(peer);

	if (ret > 0)
		return ret;
	errno = EWOULDBLOCK;
	return -1;
}

static int qnet_sendto(int s, const void *buf, int len, int flags, struct sockaddr *addr, uint32_t addrlen) {
	if (s != g_qnet_socket || s == INVALID_SOCKET)
		return sendto(s, buf, len, flags, addr, addrlen);

	qnet_send(buf, len, ntohl(((struct sockaddr_in *)addr)->sin_addr.s_addr));
	return len;
}

static int qnet_select(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds, struct timeval *timeout) {
	// Socket.IO delivers packets on the JS event loop between frames, so there is nothing
	// to wait on here; just report whether anything is queued. NET_Sleep pre-sets the fd
	// bit, and NET_GetPacket drains until qnet_recvfrom reports empty.
	return qnet_pending();
}

static int qnet_getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
	char name[256];
	size_t len;
	PeerId peer = 0;

	if (service != NULL || node == NULL || !qnet_is_host(node))
		return getaddrinfo(node, service, hints, res);

	// Strip ".qnet" and parse the "peer_<id>" form written by script.js.
	len = strlen(node) - QNET_SUFFIX_LEN;
	if (len >= sizeof(name))
		len = sizeof(name) - 1;
	memcpy(name, node, len);
	name[len] = '\0';

	if (strncmp(name, "peer_", 5) == 0)
		peer = (PeerId)strtoul(name + 5, NULL, 10);

	*res = qnet_make_addrinfo(peer);
	return 0;
}

static void qnet_freeaddrinfo(struct addrinfo *res) {
	if (res && res->ai_flags == QNET_ADDRINFO_MARKER)
		return; // statically allocated by qnet_make_addrinfo
	if (res)
		freeaddrinfo(res);
}

static struct hostent *qnet_gethostbyname(const char *name) {
	static struct hostent host;
	static struct in_addr addr;
	static char *addr_list[2];
	struct addrinfo *res = NULL;

	if (!qnet_is_host(name))
		return gethostbyname(name);

	qnet_getaddrinfo(name, NULL, NULL, &res);
	addr = ((struct sockaddr_in *)res->ai_addr)->sin_addr;
	addr_list[0] = (char *)&addr;
	addr_list[1] = NULL;

	host.h_addrtype = AF_INET;
	host.h_length = 4;
	host.h_addr_list = addr_list;
	return &host;
}

//=============================================================================
// Lifecycle (called from net_ip.c).
//=============================================================================

static PeerId qnet_peer = 0;

void QNET_Init(void) {
	// The room is joined by script.js before the engine boots, so there is nothing to set
	// up here beyond reporting status.
	if (qnet_ready())
		Com_Printf("QuickNet transport ready.\n");
	else
		Com_Printf("QuickNet transport inactive (single player).\n");
}

void QNET_Update(void) {
	if (qnet_peer == 0) {
		qnet_peer = qnet_my_peer();
		if (qnet_peer != 0)
			Com_Printf("Assigned PeerId: %u\n", qnet_peer);
	}
}

#ifndef HAVE_NET_Update
#define HAVE_NET_Update
void NET_Update(void) {
	QNET_Update();
}
#endif

//=============================================================================
// Redirect the engine's socket calls. Defined last so the shim above can call the real
// libc functions; a function-like macro is not re-expanded when it names itself.
//=============================================================================

#define socket        qnet_socket
#define recvfrom      qnet_recvfrom
#define sendto        qnet_sendto
#define select        qnet_select
#define getaddrinfo   qnet_getaddrinfo
#define freeaddrinfo  qnet_freeaddrinfo
#define gethostbyname qnet_gethostbyname

#define close(x)           ((x) == g_qnet_socket && (x) != INVALID_SOCKET ? 0 : close(x))
#define ioctl(x, ...)      ((x) == g_qnet_socket && (x) != INVALID_SOCKET ? 0 : ioctl(x, __VA_ARGS__))
#define setsockopt(x, ...) ((x) == g_qnet_socket && (x) != INVALID_SOCKET ? 0 : setsockopt(x, __VA_ARGS__))
#define bind(x, ...)       ((x) == g_qnet_socket && (x) != INVALID_SOCKET ? 0 : bind(x, __VA_ARGS__))
