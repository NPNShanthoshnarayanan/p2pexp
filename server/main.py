import json
import random
import string
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ─────────────────────────────────────────────
# TRACKER — in-memory store of all active rooms
# ─────────────────────────────────────────────
# Structure:
# swarms = {
#   "483920": {
#     "manifest": { fileName, fileSize, totalChunks, chunks[] },
#     "peers": {
#       "peer-id-1": WebSocket,
#       "peer-id-2": WebSocket,
#     }
#   }
# }
swarms = {}


# ─────────────────────────────────────────────
# HELPER: generate a random 6-digit room code
# ─────────────────────────────────────────────
def generate_room_code():
    return ''.join(random.choices(string.digits, k=6))


# ─────────────────────────────────────────────
# HELPER: generate a unique peer id
# ─────────────────────────────────────────────
def generate_peer_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))


# ─────────────────────────────────────────────
# WEBSOCKET ENDPOINT — every peer connects here
# ─────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    peer_id = generate_peer_id()
    room_code = None

    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            msg_type = message["type"]

            # ─────────────────────────────────────────
            # SEEDER: CREATE_ROOM
            # Seeder sends manifest → server creates room → returns code
            # ─────────────────────────────────────────
            if msg_type == "CREATE_ROOM":
                manifest = message["manifest"]

                # keep generating until we get a unique code
                code = generate_room_code()
                while code in swarms:
                    code = generate_room_code()

                room_code = code
                swarms[room_code] = {
                    "manifest": manifest,
                    "peers": { peer_id: websocket }
                }

                await websocket.send_text(json.dumps({
                    "type": "ROOM_CREATED",
                    "roomCode": room_code,
                    "peerId": peer_id
                }))

                print(f"[+] Room {room_code} created by peer {peer_id}")

            # ─────────────────────────────────────────
            # LEECHER: JOIN_ROOM
            # Leecher enters room code → gets manifest + peer list
            # ─────────────────────────────────────────
            elif msg_type == "JOIN_ROOM":
                code = message["roomCode"]

                if code not in swarms:
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "message": "Room not found"
                    }))
                    continue

                room_code = code
                room = swarms[room_code]

                # get existing peer ids before adding this new peer
                existing_peers = list(room["peers"].keys())

                # add new peer to room
                room["peers"][peer_id] = websocket

                # send manifest + existing peers to new leecher
                await websocket.send_text(json.dumps({
                    "type": "ROOM_JOINED",
                    "peerId": peer_id,
                    "manifest": room["manifest"],
                    "peers": existing_peers
                }))

                # notify all existing peers that a new peer joined
                for existing_id in existing_peers:
                    existing_ws = room["peers"][existing_id]
                    await existing_ws.send_text(json.dumps({
                        "type": "PEER_JOINED",
                        "peerId": peer_id
                    }))

                print(f"[+] Peer {peer_id} joined room {room_code}")

            # ─────────────────────────────────────────
            # WEBRTC SIGNALING: OFFER / ANSWER / ICE
            # Server just passes these between peers
            # Server does NOT understand these — just forwards them
            # ─────────────────────────────────────────
            elif msg_type in ("OFFER", "ANSWER", "ICE"):
                target_id = message["to"]

                if room_code and room_code in swarms:
                    room = swarms[room_code]
                    if target_id in room["peers"]:
                        target_ws = room["peers"][target_id]
                        # forward message, add sender's id
                        message["from"] = peer_id
                        await target_ws.send_text(json.dumps(message))

    # ─────────────────────────────────────────
    # PEER DISCONNECTED
    # Remove from swarm, notify others
    # ─────────────────────────────────────────
    except WebSocketDisconnect:
        if room_code and room_code in swarms:
            room = swarms[room_code]

            # remove this peer
            room["peers"].pop(peer_id, None)
            print(f"[-] Peer {peer_id} left room {room_code}")

            # notify remaining peers
            for remaining_ws in room["peers"].values():
                await remaining_ws.send_text(json.dumps({
                    "type": "PEER_LEFT",
                    "peerId": peer_id
                }))

            # if room is empty, delete it
            if not room["peers"]:
                del swarms[room_code]
                print(f"[-] Room {room_code} deleted (empty)")


# ─────────────────────────────────────────────
# SERVE FRONTEND FILES
# FastAPI serves our HTML/CSS/JS files
# Must be after websocket route
# ─────────────────────────────────────────────
app.mount("/", StaticFiles(directory="../client", html=True), name="client")