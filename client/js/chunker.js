const CHUNK_SIZE = 256 * 1024 // 256KB in bytes

async function chunkFile(file) {
    const chunks = []
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)

        const blob = file.slice(start, end)
        const arrayBuffer = await blob.arrayBuffer()

        chunks.push(arrayBuffer)
    }

    return chunks
}