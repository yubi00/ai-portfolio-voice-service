// Audio utility helpers shared by multiple voice backends.

export function getPcm16ChunkDurationMs(byteLength: number, sampleRate = 24000): number {
    const sampleCount = Math.floor(byteLength / 2);
    return (sampleCount / sampleRate) * 1000;
}
