class Swarm {
    constructor(tracker, manifest, myChunks) {
        this.tracker = tracker
        this.manifest = manifest
        this.myChunks = myChunks      // Set — chunks WE have
        this.peers = {}               // { remotePeerId: Peer }

        // chunk availability map — how many peers have each chunk
        // used by downloader for rarest-first selection
        this.chunkAvailability = new Array(manifest.totalChunks).fill(0)

        // callbacks for downloader.js
        this.onChunkReceived = null
        this.onPeerConnected = null
        this.onPeerDisconnected = null

        this._pendingIce = {}   // { remotePeerId: [candidate, ...] }

        this._setupTrackerCallbacks()
    }

    // ─────────────────────────────────────────
    // WIRE TRACKER CALLBACKS
    // tracker.js calls these when server sends events
    // ─────────────────────────────────────────
    _setupTrackerCallbacks() {
        this.tracker.onPeerJoined = (remotePeerId) => {
            console.log('[swarm] PEER_JOINED → connecting to', remotePeerId)
            this._connectToPeer(remotePeerId, true)  // we are initiator
        }

        this.tracker.onPeerLeft = (remotePeerId) => {
            this._removePeer(remotePeerId)
        }

        this.tracker.onOffer = (fromPeerId, sdp) => {
            console.log('[swarm] OFFER received from', fromPeerId)
            this._handleOffer(fromPeerId, sdp)
        }

        this.tracker.onAnswer = (fromPeerId, sdp) => {
            if (this.peers[fromPeerId]) {
                this.peers[fromPeerId].handleAnswer(sdp)
            }
        }

        this.tracker.onIce = (fromPeerId, candidate) => {
            if (this.peers[fromPeerId]) {
                this.peers[fromPeerId].handleIce(candidate)
            } else {
                // peer object not created yet — queue it
                if (!this._pendingIce[fromPeerId]) this._pendingIce[fromPeerId] = []
                this._pendingIce[fromPeerId].push(candidate)
            }
        }
    }

    // ─────────────────────────────────────────
    // CREATE AND CONNECT A PEER
    // ─────────────────────────────────────────
    _connectToPeer(remotePeerId, isInitiator) {
        if (this.peers[remotePeerId]) return  // already connected

        const peer = new Peer(remotePeerId, this.tracker, isInitiator)
        this._setupPeerCallbacks(peer)
        this.peers[remotePeerId] = peer
        peer.connect()
    }

    // ─────────────────────────────────────────
    // HANDLE OFFER — non-initiator side
    // a new peer sent us an offer → we create a peer object and answer
    // ─────────────────────────────────────────
    async _handleOffer(fromPeerId, sdp) {
        if (!this.peers[fromPeerId]) {
            const peer = new Peer(fromPeerId, this.tracker, false)  // not initiator
            this._setupPeerCallbacks(peer)
            this.peers[fromPeerId] = peer
            await peer.connect()
        }
        await this.peers[fromPeerId].handleOffer(sdp)

        // flush ICE candidates that arrived before peer object was created
        if (this._pendingIce[fromPeerId]) {
            for (const candidate of this._pendingIce[fromPeerId]) {
                await this.peers[fromPeerId].handleIce(candidate)
            }
            delete this._pendingIce[fromPeerId]
        }
    }

    // ─────────────────────────────────────────
    // WIRE PEER CALLBACKS
    // ─────────────────────────────────────────
    _setupPeerCallbacks(peer) {
        peer.onOpen = (remotePeerId) => {
            this.sendBitfieldTo(remotePeerId)
            if (this.onPeerConnected) this.onPeerConnected(remotePeerId)
        }

        peer.onBitfield = (remotePeerId, chunks) => {
            for (const chunkIndex of chunks) {
                this.chunkAvailability[chunkIndex]++
            }
            if (this.onPeerHasChunks) this.onPeerHasChunks()
        }

        peer.onHave = (remotePeerId, chunkIndex) => {
            this.chunkAvailability[chunkIndex]++
        }

        peer.onRequest = (remotePeerId, chunkIndex) => {
            this._serveChunk(remotePeerId, chunkIndex)
        }

        peer.onChunk = (remotePeerId, chunkIndex, arrayBuffer) => {
            this._handleIncomingChunk(chunkIndex, arrayBuffer)
        }

        peer.onDisconnected = (remotePeerId) => {
            this._removePeer(remotePeerId)
        }
    }

    // ─────────────────────────────────────────
    // SERVE A CHUNK — peer requested a chunk from us
    // ─────────────────────────────────────────
    _serveChunk(remotePeerId, chunkIndex) {
        const peer = this.peers[remotePeerId]
        if (!peer) return
        if (!this.myChunks.has(chunkIndex)) return  // we don't have it

        // ask downloader for the raw chunk data and send it
        if (this.getChunkData) {
            const chunkData = this.getChunkData(chunkIndex)
            if (chunkData) peer.sendChunk(chunkIndex, chunkData)
        }
    }

    // ─────────────────────────────────────────
    // HANDLE INCOMING CHUNK — received from a peer
    // ─────────────────────────────────────────
    async _handleIncomingChunk(chunkIndex, arrayBuffer) {
        const expectedHash = this.manifest.chunks[chunkIndex].hash
        const isValid = await verifyChunk(arrayBuffer, expectedHash)

        if (!isValid) {
            console.warn(`Chunk ${chunkIndex} failed hash check — discarding`)
            return
        }

        // chunk is valid — store it
        this.myChunks.add(chunkIndex)

        // broadcast HAVE to all peers
        for (const peer of Object.values(this.peers)) {
            peer.sendHave(chunkIndex)
        }

        // notify downloader
        if (this.onChunkReceived) this.onChunkReceived(chunkIndex, arrayBuffer)
    }

    // ─────────────────────────────────────────
    // REQUEST A CHUNK FROM A PEER
    // called by downloader.js
    // ─────────────────────────────────────────
    requestChunk(chunkIndex) {
        // find a peer that has this chunk
        for (const peer of Object.values(this.peers)) {
            if (peer.availableChunks.has(chunkIndex)) {
                peer.requestChunk(chunkIndex)
                return true
            }
        }
        return false  // no peer has this chunk
    }

    // ─────────────────────────────────────────
    // SEND BITFIELD TO A NEW PEER
    // called after DataChannel opens
    // ─────────────────────────────────────────
    sendBitfieldTo(remotePeerId) {
        const peer = this.peers[remotePeerId]
        if (peer) peer.sendBitfield(this.myChunks)
    }

    // ─────────────────────────────────────────
    // REMOVE PEER — disconnected or left
    // ─────────────────────────────────────────
    _removePeer(remotePeerId) {
        const peer = this.peers[remotePeerId]
        if (!peer) return  // guard — already removed, ignore second call

        // reduce availability count for all chunks this peer had
        for (const chunkIndex of peer.availableChunks) {
            this.chunkAvailability[chunkIndex]--
        }

        delete this.peers[remotePeerId]

        if (this.onPeerDisconnected) this.onPeerDisconnected(remotePeerId)
    }

    getPeerCount() {
        return Object.keys(this.peers).length
    }
}