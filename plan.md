# P2P File Sharing App — Implementation Plan

## What We Are Building
A browser-based torrent-style P2P file sharing app where:
- Files are split into 256KB chunks
- Multiple peers download different chunks simultaneously
- Every peer that has a chunk immediately shares it with others
- A 6-digit room code is used to share files

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML + CSS + Vanilla JavaScript |
| Browser APIs | File API, Web Crypto API, WebRTC, WebSocket, Streams API |
| Backend | Python + FastAPI + websockets |
| Server runner | uvicorn |
| Database | None (in-memory Python dict) |

---

## Project Structure

```
p2pexp/
├── server/
│   ├── main.py              ← FastAPI signaling server + tracker
│   └── requirements.txt
│
└── client/
    ├── index.html
    ├── style.css
    └── js/
        ├── chunker.js       ← split file into 256KB chunks
        ├── manifest.js      ← create/parse manifest JSON
        ├── tracker.js       ← WebSocket client (talk to server)
        ├── peer.js          ← single WebRTC connection + DataChannel
        ├── swarm.js         ← manage multiple peer connections
        ├── downloader.js    ← rarest-first chunk selection + reassembly
        ├── verifier.js      ← SHA-256 chunk integrity check
        └── ui.js            ← file picker, progress bar, room code UI
```

---

## Core Concepts (locked decisions)

| Decision | Value |
|---|---|
| Chunk size | 256 KB |
| Piece selection | Rarest-first |
| Max peers per swarm | 10 |
| Chunk integrity | SHA-256 via Web Crypto API |
| Share mechanism | 6-digit room code + infoHash in URL |
| Storage | In-memory on server (no DB) |
| Manifest integrity | SHA-256 hash of entire manifest (infoHash) |

---

## Server In-Memory Structure

```python
swarms = {
    "483920": {
        "manifest": { ...manifest JSON... },
        "peers": [peerA, peerB, peerC]
    }
}
```

Room disappears when all peers disconnect.

---

## WebSocket Message Types (Browser ↔ Server)

```json
// Browser → Server: register as seeder with manifest
{ "type": "CREATE_ROOM", "manifest": { ... } }

// Server → Browser: room created
{ "type": "ROOM_CREATED", "roomCode": "483920" }

// Browser → Server: join as leecher
{ "type": "JOIN_ROOM", "roomCode": "483920" }

// Server → Browser: manifest + existing peers
{ "type": "ROOM_JOINED", "manifest": { ... }, "peers": ["peerA"] }

// Server → Browser: new peer joined swarm
{ "type": "PEER_JOINED", "peerId": "peerB" }

// Server → Browser: peer left swarm
{ "type": "PEER_LEFT", "peerId": "peerA" }

// WebRTC signaling (passed through server)
{ "type": "OFFER",     "to": "peerB", "sdp": "..." }
{ "type": "ANSWER",    "to": "peerA", "sdp": "..." }
{ "type": "ICE",       "to": "peerB", "candidate": "..." }
```

---

## DataChannel Message Types (Browser ↔ Browser, direct)

```json
// Request a chunk
{ "type": "REQUEST", "chunkIndex": 42 }

// Send a chunk (binary data attached separately)
{ "type": "CHUNK", "chunkIndex": 42 }

// Announce you now have a chunk
{ "type": "HAVE", "chunkIndex": 42 }

// Send list of chunks you have on connect
{ "type": "BITFIELD", "chunks": [0, 1, 5, 6, 10] }
```

---

## Manifest JSON Structure

```json
{
  "fileName": "movie.mp4",
  "fileSize": 1073741824,
  "chunkSize": 262144,
  "totalChunks": 4096,
  "chunks": [
    { "index": 0, "hash": "a591a6d40bf420..." },
    { "index": 1, "hash": "b7d3f8c91ae2..." }
  ]
}
```

## infoHash — Manifest Integrity

```
infoHash = SHA-256 of the entire manifest JSON string

Seeder computes infoHash → puts it in share link
Leecher receives manifest from server → hashes it → compares with infoHash from link
Match ✅ → manifest is genuine
No match ❌ → manifest was tampered → reject

Share link format:
  http://localhost:8000?room=483920&info=abc123def456...
```

This prevents:
- Server tampering with manifest
- Man-in-the-middle attacks on manifest

This cannot prevent:
- Malicious seeder creating a fake manifest from the start (they control the link)

---

## Full Flow

### Seeder (uploading)
1. User picks file via File API
2. `chunker.js` splits file into 256KB ArrayBuffers
3. `verifier.js` computes SHA-256 hash for each chunk via Web Crypto API
4. `manifest.js` creates manifest JSON + computes infoHash (SHA-256 of manifest)
5. `tracker.js` sends `CREATE_ROOM` to server via WebSocket
6. Server stores manifest, returns 6-digit room code
7. UI displays share link: `?room=483920&info=abc123...`
8. As peers join, `swarm.js` opens WebRTC connections
9. `peer.js` responds to `REQUEST` messages by sending chunks over DataChannel

### Leecher (downloading)
1. User opens share link → room code + infoHash extracted from URL
2. `tracker.js` sends `JOIN_ROOM` to server
3. Server returns manifest + list of peers
4. `manifest.js` verifies received manifest hash matches infoHash from URL
5. If hash mismatch → reject, show error
6. `swarm.js` connects to all peers via WebRTC (handshake through WebSocket)
7. Each `peer.js` sends `BITFIELD` (what chunks it has)
8. `downloader.js` picks rarest chunks first, sends `REQUEST` to appropriate peer
9. Incoming chunk → `verifier.js` checks SHA-256 hash
10. Valid chunk stored, `HAVE` broadcast to all peers
11. When all chunks received → Streams API reassembles → browser triggers file download

---

## Implementation Order

1. **server/main.py** — FastAPI + WebSocket signaling server + tracker
2. **client/js/chunker.js** — file splitting
3. **client/js/manifest.js** — manifest creation and parsing
4. **client/js/verifier.js** — SHA-256 hashing
5. **client/js/tracker.js** — WebSocket client
6. **client/js/peer.js** — single WebRTC + DataChannel
7. **client/js/swarm.js** — multi-peer management
8. **client/js/downloader.js** — rarest-first + reassembly
9. **client/index.html + style.css** — basic UI
10. **client/js/ui.js** — wire UI to all modules

---

## Key Constraints to Remember
- WebSocket disconnect → tracker removes peer → swarm notified immediately
- If original seeder leaves before leechers finish → warn user (chunks may be lost)
- Chunks verified by hash before storing — corrupted chunks are discarded and re-requested
- Server only handles signaling — no file data ever touches the server
- infoHash in share link is the source of truth — leecher must verify manifest against it
- Malicious seeder cannot be stopped — they control both manifest and infoHash