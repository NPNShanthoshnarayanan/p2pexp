const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const SERVER_URL = `${protocol}//${window.location.host}/ws`

// ── DOM elements ──
const fileInput        = document.getElementById('file-input')
const fileDrop         = document.getElementById('file-drop')
const selectedFile     = document.getElementById('selected-file')
const shareBtn         = document.getElementById('share-btn')
const shareResult      = document.getElementById('share-result')
const shareLinkEl      = document.getElementById('share-link')
const copyBtn          = document.getElementById('copy-btn')
const seederPeerCount  = document.getElementById('seeder-peer-count')

const roomInput        = document.getElementById('room-input')
const downloadBtn      = document.getElementById('download-btn')
const downloadStatus   = document.getElementById('download-status')
const fileInfo         = document.getElementById('file-info')
const progressBar      = document.getElementById('progress-bar')
const progressText     = document.getElementById('progress-text')
const leecherPeerCount = document.getElementById('leecher-peer-count')

// ── State ──
let selectedFileObj = null
let seederSwarm = null
let seederChunks = []

// ─────────────────────────────────────────
// FILE SELECTION
// ─────────────────────────────────────────
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]
    if (!file) return
    selectedFileObj = file
    selectedFile.textContent = `${file.name} (${formatBytes(file.size)})`
    shareBtn.disabled = false
})

// drag and drop
fileDrop.addEventListener('dragover', (e) => {
    e.preventDefault()
    fileDrop.classList.add('drag-over')
})

fileDrop.addEventListener('dragleave', () => {
    fileDrop.classList.remove('drag-over')
})

fileDrop.addEventListener('drop', (e) => {
    e.preventDefault()
    fileDrop.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (!file) return
    selectedFileObj = file
    selectedFile.textContent = `${file.name} (${formatBytes(file.size)})`
    shareBtn.disabled = false
})

// ─────────────────────────────────────────
// SEEDER — share file
// ─────────────────────────────────────────
shareBtn.addEventListener('click', async () => {
    if (!selectedFileObj) return

    shareBtn.disabled = true
    shareBtn.textContent = 'Preparing...'

    // step 1 — chunk the file
    const chunks = await chunkFile(selectedFileObj)
    seederChunks = chunks

    // step 2 — create manifest + infoHash
    const { manifest, infoHash } = await createManifest(selectedFileObj, chunks)

    // step 3 — connect to server
    const tracker = new Tracker(SERVER_URL)
    await tracker.connect()

    // step 4 — create room
    const { roomCode } = await tracker.createRoom(manifest)

    // step 5 — setup swarm
    const myChunks = new Set(chunks.map((_, i) => i))  // seeder has ALL chunks
    seederSwarm = new Swarm(tracker, manifest, myChunks)

    // give swarm access to chunk data
    seederSwarm.getChunkData = (chunkIndex) => seederChunks[chunkIndex]

    // update peer count when peers join/leave
    seederSwarm.onPeerConnected = () => {
        seederPeerCount.textContent = seederSwarm.getPeerCount()
    }
    seederSwarm.onPeerDisconnected = () => {
        seederPeerCount.textContent = seederSwarm.getPeerCount()
    }

    // step 6 — build share link
    const shareLink = `${window.location.origin}?room=${roomCode}&info=${infoHash}`
    shareLinkEl.textContent = shareLink

    shareResult.classList.remove('hidden')
    shareBtn.textContent = 'Sharing...'
})

// copy link button
copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkEl.textContent)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => copyBtn.textContent = 'Copy', 2000)
})

// ─────────────────────────────────────────
// LEECHER — download file
// ─────────────────────────────────────────
downloadBtn.addEventListener('click', async () => {
    const input = roomInput.value.trim()
    if (!input) return

    // extract room code and infoHash from link or plain code
    let roomCode, infoHash

    if (input.includes('?')) {
        const url = new URL(input)
        roomCode = url.searchParams.get('room')
        infoHash = url.searchParams.get('info')
    } else {
        roomCode = input  // plain room code — no manifest verification
    }

    if (!roomCode) {
        alert('Invalid link or room code')
        return
    }

    downloadBtn.disabled = true
    downloadBtn.textContent = 'Connecting...'

    // step 1 — connect to server
    const tracker = new Tracker(SERVER_URL)
    await tracker.connect()

    // step 2 — join room
    let result
    try {
        result = await tracker.joinRoom(roomCode)
    } catch (e) {
        alert('Room not found. Check the link or code.')
        downloadBtn.disabled = false
        downloadBtn.textContent = 'Download'
        return
    }

    const { manifest, peers } = result
    const parsedManifest = parseManifest(manifest)

    // step 3 — setup swarm IMMEDIATELY before any await
    // so tracker.onOffer is set before OFFER can arrive
    const myChunks = new Set()
    const swarm = new Swarm(tracker, parsedManifest, myChunks)

    swarm.onPeerConnected = () => {
        leecherPeerCount.textContent = swarm.getPeerCount()
    }
    swarm.onPeerDisconnected = () => {
        leecherPeerCount.textContent = swarm.getPeerCount()
    }

    // step 4 — verify manifest integrity (safe to await now — swarm already set up)
    if (infoHash) {
        const isValid = await verifyManifest(manifest, infoHash)
        if (!isValid) {
            alert('Manifest integrity check failed. This file may have been tampered with.')
            downloadBtn.disabled = false
            downloadBtn.textContent = 'Download'
            return
        }
    }

    // step 5 — show file info
    fileInfo.textContent = `${parsedManifest.fileName} (${formatBytes(parsedManifest.fileSize)})`
    downloadStatus.classList.remove('hidden')
    downloadBtn.textContent = 'Downloading...'

    // step 6 — setup downloader
    const downloader = new Downloader(parsedManifest, swarm)

    downloader.onProgress = (downloaded, total) => {
        const pct = Math.floor((downloaded / total) * 100)
        progressBar.style.width = `${pct}%`
        progressText.textContent = `${pct}% (${downloaded} / ${total} chunks)`
    }

    downloader.onComplete = () => {
        progressText.textContent = 'Complete!'
        downloadBtn.textContent = 'Done'
    }

    // step 7 — start downloading (existing peers will send OFFER to us automatically)
    downloader.start()
})

// ─────────────────────────────────────────
// AUTO JOIN if URL has room param
// ─────────────────────────────────────────
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('room')) {
        roomInput.value = window.location.href
    }
})

// ─────────────────────────────────────────
// HELPER — format bytes
// ─────────────────────────────────────────
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}