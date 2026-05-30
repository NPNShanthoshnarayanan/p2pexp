async function createManifest(file, chunks) {
    const chunkHashes = []

    for (let i = 0; i < chunks.length; i++) {
        const hash = await hashChunk(chunks[i])
        chunkHashes.push({ index: i, hash })
    }

    const manifest = {
        fileName: file.name,
        fileSize: file.size,
        chunkSize: 256 * 1024,
        totalChunks: chunks.length,
        chunks: chunkHashes
    }

    const infoHash = await hashManifest(manifest)

    return { manifest, infoHash }
}

function parseManifest(manifest) {
    return {
        fileName: manifest.fileName,
        fileSize: manifest.fileSize,
        chunkSize: manifest.chunkSize,
        totalChunks: manifest.totalChunks,
        chunks: manifest.chunks
    }
}