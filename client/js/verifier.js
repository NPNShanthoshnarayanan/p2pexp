const cryptoAvailable = typeof crypto !== 'undefined' && crypto.subtle

async function hashChunk(arrayBuffer) {
    if (!cryptoAvailable) return 'no-crypto'
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyChunk(arrayBuffer, expectedHash) {
    if (!cryptoAvailable) return true  // skip verification on non-secure contexts
    const actualHash = await hashChunk(arrayBuffer)
    return actualHash === expectedHash
}

async function hashManifest(manifest) {
    if (!cryptoAvailable) return 'no-crypto'
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
    const hashBuffer = await crypto.subtle.digest('SHA-256', manifestBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyManifest(manifest, expectedInfoHash) {
    if (!cryptoAvailable) return true  // skip verification on non-secure contexts
    const actualInfoHash = await hashManifest(manifest)
    return actualInfoHash === expectedInfoHash
}