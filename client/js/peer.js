class Peer {
    constructor(peerId, tracker, isInitiator) {
        this.remotePeerId = peerId
        this.tracker = tracker
        this.isInitiator = isInitiator

        this.connection = null
        this.dataChannel = null
        this.availableChunks = new Set()
        this._pendingChunkIndex = null    // tracks incoming binary chunk
        this._disconnected = false        // guard against double disconnect
        this._pendingIceCandidates = []   // queue ICE until setRemoteDescription done

        // callbacks — filled in by swarm.js
        this.onOpen = null
        this.onBitfield = null
        this.onHave = null
        this.onRequest = null
        this.onChunk = null
        this.onDisconnected = null
    }

    // ─────────────────────────────────────────
    // SETUP — create RTCPeerConnection
    // ─────────────────────────────────────────
    async connect() {
        this.connection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        })

        // when browser finds an ICE candidate, forward it to the other peer
        this.connection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[peer] ICE OUT:', event.candidate.type, event.candidate.candidate, '→', this.remotePeerId)
                this.tracker.sendIce(this.remotePeerId, event.candidate)
            } else {
                console.log('[peer] ICE gathering complete for', this.remotePeerId)
            }
        }

        this.connection.oniceconnectionstatechange = () => {
            console.log('[peer] ICE connection state:', this.connection.iceConnectionState, '←', this.remotePeerId)
        }

        // detect disconnection
        this.connection.onconnectionstatechange = () => {
            const state = this.connection.connectionState
            console.log('[peer] connection state:', state, '←', this.remotePeerId)
            if (state === 'disconnected' || state === 'failed') {
                this._handleDisconnect()
            }
        }

        if (this.isInitiator) {
            // initiator creates the DataChannel
            this.dataChannel = this.connection.createDataChannel('fileTransfer')
            this.dataChannel.binaryType = 'arraybuffer'
            this._setupDataChannel()

            // initiator creates and sends OFFER
            const offer = await this.connection.createOffer()
            await this.connection.setLocalDescription(offer)
            console.log('[peer] sending OFFER to', this.remotePeerId)
            this.tracker.sendOffer(this.remotePeerId, offer)

        } else {
            // non-initiator waits for DataChannel from initiator
            this.connection.ondatachannel = (event) => {
                this.dataChannel = event.channel
                this.dataChannel.binaryType = 'arraybuffer'
                this._setupDataChannel()
            }
        }
    }

    // ─────────────────────────────────────────
    // WEBRTC HANDSHAKE — called by swarm.js
    // ─────────────────────────────────────────
    async handleOffer(sdp) {
        await this.connection.setRemoteDescription(sdp)

        // flush ICE candidates that arrived before setRemoteDescription
        for (const candidate of this._pendingIceCandidates) {
            await this.connection.addIceCandidate(candidate)
        }
        this._pendingIceCandidates = []

        const answer = await this.connection.createAnswer()
        await this.connection.setLocalDescription(answer)
        console.log('[peer] sending ANSWER to', this.remotePeerId)
        this.tracker.sendAnswer(this.remotePeerId, answer)
    }

    async handleAnswer(sdp) {
        await this.connection.setRemoteDescription(sdp)

        // flush ICE candidates that arrived before setRemoteDescription
        for (const candidate of this._pendingIceCandidates) {
            await this.connection.addIceCandidate(candidate)
        }
        this._pendingIceCandidates = []
    }

    async handleIce(candidate) {
        console.log('[peer] ICE IN:', candidate.type, candidate.candidate, '←', this.remotePeerId)
        if (!this.connection.remoteDescription) {
            this._pendingIceCandidates.push(candidate)
            return
        }
        await this.connection.addIceCandidate(candidate)
    }

    // ─────────────────────────────────────────
    // DATACHANNEL SETUP — attach event listeners
    // ─────────────────────────────────────────
    _setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log(`DataChannel open with peer ${this.remotePeerId}`)
            if (this.onOpen) this.onOpen(this.remotePeerId)
        }

        this.dataChannel.onclose = () => {
            this._handleDisconnect()
        }

        this.dataChannel.onmessage = (event) => {
            this._handleMessage(event.data)
        }
    }

    // ─────────────────────────────────────────
    // INCOMING MESSAGE HANDLER
    // ─────────────────────────────────────────
    _handleMessage(data) {
        // binary data = actual chunk bytes
        if (data instanceof ArrayBuffer) {
            if (this._pendingChunkIndex !== null) {
                if (this.onChunk) this.onChunk(this.remotePeerId, this._pendingChunkIndex, data)
                this._pendingChunkIndex = null
            }
            return
        }

        // string data = JSON control message
        const message = JSON.parse(data)

        switch (message.type) {
            case 'BITFIELD':
                this.availableChunks = new Set(message.chunks)
                if (this.onBitfield) this.onBitfield(this.remotePeerId, message.chunks)
                break

            case 'HAVE':
                this.availableChunks.add(message.chunkIndex)
                if (this.onHave) this.onHave(this.remotePeerId, message.chunkIndex)
                break

            case 'REQUEST':
                if (this.onRequest) this.onRequest(this.remotePeerId, message.chunkIndex)
                break

            case 'CHUNK':
                // next incoming message will be binary chunk data
                this._pendingChunkIndex = message.chunkIndex
                break
        }
    }

    // ─────────────────────────────────────────
    // OUTGOING MESSAGES
    // ─────────────────────────────────────────
    sendBitfield(myChunks) {
        this._send(JSON.stringify({
            type: 'BITFIELD',
            chunks: Array.from(myChunks)
        }))
    }

    sendHave(chunkIndex) {
        this._send(JSON.stringify({
            type: 'HAVE',
            chunkIndex
        }))
    }

    requestChunk(chunkIndex) {
        this._send(JSON.stringify({
            type: 'REQUEST',
            chunkIndex
        }))
    }

    sendChunk(chunkIndex, arrayBuffer) {
        // step 1 — send metadata
        this._send(JSON.stringify({ type: 'CHUNK', chunkIndex }))
        // step 2 — send raw bytes
        this._send(arrayBuffer)
    }

    // ─────────────────────────────────────────
    // DISCONNECT GUARD — fires only once
    // ─────────────────────────────────────────
    _handleDisconnect() {
        if (this._disconnected) return
        this._disconnected = true
        if (this.onDisconnected) this.onDisconnected(this.remotePeerId)
    }

    // ─────────────────────────────────────────
    // INTERNAL SEND — checks channel is open
    // ─────────────────────────────────────────
    _send(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data)
        }
    }
}