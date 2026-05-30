class Tracker {
    constructor(serverUrl) {
        this.serverUrl = serverUrl
        this.socket = null
        this.peerId = null

        // callbacks — filled in by swarm.js later
        this.onPeerJoined = null
        this.onPeerLeft = null
        this.onOffer = null
        this.onAnswer = null
        this.onIce = null
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(this.serverUrl)

            this.socket.onopen = () => {
                console.log('Connected to signaling server')
                resolve()
            }

            this.socket.onmessage = (event) => {
                const message = JSON.parse(event.data)
                this._handleMessage(message)
            }

            this.socket.onclose = () => {
                console.log('Disconnected from signaling server')
            }

            this.socket.onerror = (error) => {
                reject(error)
            }
        })
    }

    // ─────────────────────────────────────────
    // SEEDER: create a room with the manifest
    // ─────────────────────────────────────────
    createRoom(manifest) {
        return new Promise((resolve, reject) => {
            this._pendingResolve = resolve
            this._pendingReject = reject

            this.socket.send(JSON.stringify({
                type: 'CREATE_ROOM',
                manifest
            }))
        })
    }

    // ─────────────────────────────────────────
    // LEECHER: join an existing room
    // ─────────────────────────────────────────
    joinRoom(roomCode) {
        return new Promise((resolve, reject) => {
            this._pendingResolve = resolve
            this._pendingReject = reject

            this.socket.send(JSON.stringify({
                type: 'JOIN_ROOM',
                roomCode
            }))
        })
    }

    // ─────────────────────────────────────────
    // SEND WebRTC signaling messages to a peer
    // ─────────────────────────────────────────
    sendOffer(toPeerId, sdp) {
        this.socket.send(JSON.stringify({
            type: 'OFFER',
            to: toPeerId,
            sdp
        }))
    }

    sendAnswer(toPeerId, sdp) {
        this.socket.send(JSON.stringify({
            type: 'ANSWER',
            to: toPeerId,
            sdp
        }))
    }

    sendIce(toPeerId, candidate) {
        this.socket.send(JSON.stringify({
            type: 'ICE',
            to: toPeerId,
            candidate
        }))
    }

    // ─────────────────────────────────────────
    // HANDLE incoming messages from server
    // ─────────────────────────────────────────
    _handleMessage(message) {
        switch (message.type) {

            case 'ROOM_CREATED':
                this.peerId = message.peerId
                if (this._pendingResolve) {
                    this._pendingResolve({ roomCode: message.roomCode, peerId: message.peerId })
                    this._pendingResolve = null
                }
                break

            case 'ROOM_JOINED':
                this.peerId = message.peerId
                if (this._pendingResolve) {
                    this._pendingResolve({
                        peerId: message.peerId,
                        manifest: message.manifest,
                        peers: message.peers
                    })
                    this._pendingResolve = null
                }
                break

            case 'ERROR':
                if (this._pendingReject) {
                    this._pendingReject(new Error(message.message))
                    this._pendingReject = null
                }
                break

            // forward WebRTC signals to swarm.js via callbacks
            case 'PEER_JOINED':
                console.log('[tracker] PEER_JOINED:', message.peerId, '| onPeerJoined set:', !!this.onPeerJoined)
                if (this.onPeerJoined) this.onPeerJoined(message.peerId)
                break

            case 'PEER_LEFT':
                if (this.onPeerLeft) this.onPeerLeft(message.peerId)
                break

            case 'OFFER':
                console.log('[tracker] OFFER received from:', message.from, '| onOffer set:', !!this.onOffer)
                if (this.onOffer) this.onOffer(message.from, message.sdp)
                break

            case 'ANSWER':
                console.log('[tracker] ANSWER received from:', message.from)
                if (this.onAnswer) this.onAnswer(message.from, message.sdp)
                break

            case 'ICE':
                if (this.onIce) this.onIce(message.from, message.candidate)
                break
        }
    }
}