class Downloader {
    constructor(manifest, swarm) {
        this.manifest = manifest
        this.swarm = swarm

        this.chunks = new Array(manifest.totalChunks).fill(null)  // stores received chunks
        this.downloadedCount = 0
        this.inProgress = new Set()   // chunk indices currently being requested

        this.onProgress = null        // callback → ui.js (progress bar)
        this.onComplete = null        // callback → ui.js (trigger file save)

        // give swarm a way to fetch chunk data when serving to other peers
        this.swarm.getChunkData = (chunkIndex) => this.chunks[chunkIndex]

        // when swarm receives a valid chunk → store it here
        this.swarm.onChunkReceived = (chunkIndex, arrayBuffer) => {
            this._storeChunk(chunkIndex, arrayBuffer)
        }
    }

    // ─────────────────────────────────────────
    // START DOWNLOADING
    // ─────────────────────────────────────────
    start() {
        this._requestNextChunks()

        // retry when a new peer sends their BITFIELD (chunks become available)
        this.swarm.onPeerHasChunks = () => {
            this._requestNextChunks()
        }
    }

    // ─────────────────────────────────────────
    // STORE A RECEIVED CHUNK
    // ─────────────────────────────────────────
    _storeChunk(chunkIndex, arrayBuffer) {
        this.chunks[chunkIndex] = arrayBuffer
        this.inProgress.delete(chunkIndex)
        this.downloadedCount++

        if (this.onProgress) {
            this.onProgress(this.downloadedCount, this.manifest.totalChunks)
        }

        if (this.downloadedCount === this.manifest.totalChunks) {
            this._assembleFile()
            return
        }

        // request more chunks to keep pipeline full
        this._requestNextChunks()
    }

    // ─────────────────────────────────────────
    // RAREST FIRST — pick next chunks to request
    // ─────────────────────────────────────────
    _requestNextChunks() {
        const MAX_IN_PROGRESS = 10  // max parallel chunk requests

        const needed = this._getRarestChunks(MAX_IN_PROGRESS - this.inProgress.size)

        for (const chunkIndex of needed) {
            this.inProgress.add(chunkIndex)
            const success = this.swarm.requestChunk(chunkIndex)

            if (!success) {
                // no peer has this chunk right now — unqueue it
                this.inProgress.delete(chunkIndex)
            }
        }
    }

    // ─────────────────────────────────────────
    // GET RAREST CHUNKS — sorted by availability
    // ─────────────────────────────────────────
    _getRarestChunks(count) {
        const candidates = []

        for (let i = 0; i < this.manifest.totalChunks; i++) {
            const alreadyHave   = this.chunks[i] !== null
            const alreadyAsked  = this.inProgress.has(i)
            const noPeerHasIt   = this.swarm.chunkAvailability[i] === 0

            if (alreadyHave || alreadyAsked || noPeerHasIt) continue

            candidates.push({
                index: i,
                availability: this.swarm.chunkAvailability[i]
            })
        }

        // sort by rarest first (lowest availability count)
        candidates.sort((a, b) => a.availability - b.availability)

        return candidates.slice(0, count).map(c => c.index)
    }

    // ─────────────────────────────────────────
    // ASSEMBLE FILE — all chunks received
    // ─────────────────────────────────────────
    _assembleFile() {
        const blob = new Blob(this.chunks, { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)

        const a = document.createElement('a')
        a.href = url
        a.download = this.manifest.fileName
        a.click()

        URL.revokeObjectURL(url)

        if (this.onComplete) this.onComplete()
    }
}