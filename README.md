# P2P File Share

A browser-based peer-to-peer file sharing app inspired by BitTorrent. Files are transferred **directly between browsers** — the server only helps peers find each other, like a matchmaker.

---

## The Simple Analogy

> Imagine you want to share a pizza recipe with your friend.
> You call a **reception desk** (server) and say *"I have a recipe, give me a room number"*.
> Your friend calls the same desk and says *"I want room 429"*.
> The desk introduces you two — then **steps aside**.
> From that point, you talk directly with your friend. The desk is out of the loop.

That's exactly how this app works — except instead of a recipe, it's any file.

---

## The Big Picture

```mermaid
graph LR
    A["📱 Seeder\n(has the file)"] -->|"1. I have a file"| S["🖥️ Server\nSignaling Only"]
    S -->|"2. Room code: 429301"| A
    B["💻 Leecher\n(wants the file)"] -->|"3. I want room 429301"| S
    S -->|"4. Your friend is here"| B
    A <-->|"5. Direct connection!\nFile transfers here\nServer not involved ✅"| B
```

---

## Step 1 — Seeder: Sharing a File

```mermaid
flowchart TD
    A["📁 Pick a file\ne.g. video.mp4 · 800MB"] --> B["✂️ Split into 256KB chunks\nChunk 0 · Chunk 1 · Chunk 2 · ..."]
    B --> C["🔏 Fingerprint each chunk\nSHA-256 hash\nso the receiver can verify nothing is corrupted"]
    C --> D["📋 Build a Manifest\nfile name · file size · all chunk fingerprints"]
    D --> E["📡 Tell Server\nI am sharing this file"]
    E --> F["🎟️ Get a Room Code\ne.g. 429301"]
    F --> G["🔗 Share the Link\nhttps://yourapp.com?room=429301"]
```

---

## Step 2 — Leecher: Downloading a File

```mermaid
flowchart TD
    A["🔗 Open the share link"] --> B["📡 Ask Server to join room 429301"]
    B --> C["📋 Receive Manifest\nnow knows file name · size · chunk fingerprints"]
    C --> D["🤝 Connect Directly to Seeder\nWebRTC — no server involved"]
    D --> E["📥 Request a chunk\nPicks the RAREST chunk first"]
    E --> F["🔏 Verify fingerprint\ndoes received chunk match manifest?"]
    F -->|"✅ Yes — keep it"| G["💾 Store the chunk"]
    F -->|"❌ No — corrupted"| E
    G --> H{"Got all chunks?"}
    H -->|"No"| E
    H -->|"✅ Yes"| I["🧩 Reassemble all chunks into original file"]
    I --> J["⬇️ File downloaded!"]
```

---

## Full Conversation — Seeder, Server, and Leecher

```mermaid
sequenceDiagram
    participant S as 📱 Seeder
    participant Srv as 🖥️ Server
    participant L as 💻 Leecher

    Note over S: Splits file into chunks, builds manifest

    S->>Srv: CREATE_ROOM (send manifest)
    Srv-->>S: ROOM_CREATED ✅ room code = 429301

    Note over S: Shares the link with friend

    L->>Srv: JOIN_ROOM (429301)
    Srv-->>L: ROOM_JOINED ✅ here is the manifest
    Srv->>S: PEER_JOINED 👋 a leecher arrived

    Note over S,L: WebRTC handshake — routed through server just once

    S->>Srv: OFFER (connection proposal)
    Srv->>L: OFFER (forwarded)
    L->>Srv: ANSWER (accepted)
    Srv->>S: ANSWER (forwarded)
    S-->Srv: ICE candidates (network paths)
    Srv-->L: ICE candidates (forwarded)

    Note over S,L: ✅ Direct connection established — server steps aside

    S-->>L: BITFIELD — I have chunks [0, 1, 2, 3]
    L-->>S: REQUEST chunk 0
    S-->>L: CHUNK 0 (256KB binary data)
    Note over L: Verify fingerprint ✅ store chunk
    L-->>S: REQUEST chunk 1
    S-->>L: CHUNK 1 (256KB binary data)
    Note over L: Verify fingerprint ✅ store chunk
    Note over L: All chunks received → reassemble → download ⬇️
```

---

## What Happens With Multiple Peers

Once a leecher finishes downloading a chunk, it becomes a seeder for that chunk too.
Everyone shares with everyone — the more peers, the faster the download.

```mermaid
graph TD
    S["📱 Seeder\nhas all chunks"] -->|chunk 0| A["💻 Leecher A"]
    S -->|chunk 1| B["📱 Leecher B"]
    S -->|chunk 2| C["🖥️ Leecher C"]
    A -->|chunk 0| B
    A -->|chunk 0| C
    B -->|chunk 1| A
    B -->|chunk 1| C
    C -->|chunk 2| A
    C -->|chunk 2| B
```

---

## Full Conversation — With Multiple Peers

```mermaid
sequenceDiagram
    participant S as 📱 Seeder
    participant Srv as 🖥️ Server
    participant A as 💻 Leecher A
    participant B as 📱 Leecher B

    Note over S: Splits file into 3 chunks [0, 1, 2]

    S->>Srv: CREATE_ROOM
    Srv-->>S: ROOM_CREATED ✅ room = 429301

    Note over A: Leecher A joins first

    A->>Srv: JOIN_ROOM (429301)
    Srv-->>A: ROOM_JOINED ✅ manifest received
    Srv->>S: PEER_JOINED 👋 Leecher A arrived

    Note over S,A: WebRTC handshake — S is initiator
    S->>A: OFFER → ANSWER → ICE (via server)
    Note over S,A: ✅ Direct connection — server steps aside

    S-->>A: BITFIELD [0, 1, 2] — I have all chunks
    A-->>S: REQUEST chunk 0
    S-->>A: CHUNK 0 ✅
    A-->>S: REQUEST chunk 1
    S-->>A: CHUNK 1 ✅
    Note over A: Now A has chunks [0, 1]
    A-->>S: HAVE chunk 0 📢
    A-->>S: HAVE chunk 1 📢

    Note over B: Leecher B joins while A is still downloading

    B->>Srv: JOIN_ROOM (429301)
    Srv-->>B: ROOM_JOINED ✅ manifest received
    Srv->>S: PEER_JOINED 👋 Leecher B arrived
    Srv->>A: PEER_JOINED 👋 Leecher B arrived

    Note over S,B: S connects to B (S is initiator)
    S->>B: OFFER → ANSWER → ICE (via server)
    Note over S,B: ✅ S — B direct connection

    Note over A,B: A also connects to B (A is initiator)
    A->>B: OFFER → ANSWER → ICE (via server)
    Note over A,B: ✅ A — B direct connection

    S-->>B: BITFIELD [0, 1, 2]
    A-->>B: BITFIELD [0, 1]

    Note over B: chunk 2 is rarest — only S has it → request from S
    B-->>S: REQUEST chunk 2
    S-->>B: CHUNK 2 ✅

    Note over B: chunks 0 and 1 — both S and A have them → picks first peer (S)
    B-->>S: REQUEST chunk 0
    S-->>B: CHUNK 0 ✅
    B-->>A: REQUEST chunk 1
    A-->>B: CHUNK 1 ✅

    Note over B: All chunks received → file downloaded ⬇️

    B-->>S: HAVE chunk 0 📢
    B-->>S: HAVE chunk 1 📢
    B-->>S: HAVE chunk 2 📢
    B-->>A: HAVE chunk 0 📢
    B-->>A: HAVE chunk 1 📢
    B-->>A: HAVE chunk 2 📢
    Note over A,B: Now B is also a full seeder for future peers
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Signaling server | Python · FastAPI · WebSocket |
| P2P transport | WebRTC DataChannel |
| Frontend | Vanilla JS · HTML · CSS |
| Integrity check | SHA-256 (Web Crypto API) |

---

## Project Structure

```
p2pexp/
├── server/
│   ├── main.py          # signaling server — room management + message forwarding
│   └── requirements.txt
└── client/
    ├── index.html
    ├── style.css
    └── js/
        ├── chunker.js   # splits file into 256KB pieces
        ├── verifier.js  # SHA-256 fingerprinting and verification
        ├── manifest.js  # builds and parses the file manifest
        ├── tracker.js   # WebSocket client — talks to signaling server
        ├── peer.js      # one WebRTC connection per peer
        ├── swarm.js     # manages all peers and chunk availability map
        ├── downloader.js# rarest-first chunk scheduling
        └── ui.js        # seeder and leecher UI
```

---

## Run Locally

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Open `http://localhost:8000` in **Firefox** (two tabs — one seeder, one leecher).

> Chrome hides local IPs behind mDNS hostnames for privacy, which breaks same-machine WebRTC without a TURN relay server. Firefox does not have this issue.

---

## Known Limitations

| Limitation | Reason |
|------------|--------|
| Entire file held in RAM | Chunks stored as ArrayBuffers in memory — large files may crash on mobile |
| Same-WiFi on Chrome fails | Chrome mDNS + routers not supporting hairpin NAT |
| No TURN server included | Add one (e.g. [Metered](https://metered.ca)) in `peer.js` for full cross-network reliability |