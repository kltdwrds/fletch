// An MP3's duration from its frames (F71): the speaker's answer is checked against the text it was asked to say before
// anything is written, so a render cut short is refused SPEECH_PARTIAL and never delivered (B-P13-06). Walks MPEG audio
// frame headers (MPEG 1, 2 and 2.5, Layers I to III) after any ID3v2 tag; bytes that are not a frame end the walk.

const BITRATES: Record<string, number[]> = {
  // [version 1 | 2][layer 1..3], kbit/s by index 1..14.
  "1-1": [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

/** The audio's length in milliseconds and the frames counted; zero frames when the bytes hold no MPEG audio. */
export function mp3Duration(bytes: Uint8Array): { ms: number; frames: number } {
  let i = 0;
  // ID3v2: "ID3", version, flags, then a 28-bit syncsafe size.
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    i = 10 + (((bytes[6] ?? 0) & 0x7f) << 21) + (((bytes[7] ?? 0) & 0x7f) << 14) + (((bytes[8] ?? 0) & 0x7f) << 7) + ((bytes[9] ?? 0) & 0x7f);
  }
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= bytes.length) {
    const b1 = bytes[i + 1] as number;
    const b2 = bytes[i + 2] as number;
    if (bytes[i] !== 0xff || (b1 & 0xe0) !== 0xe0) break;
    const v = (b1 >> 3) & 3; // 0: 2.5, 2: 2, 3: 1
    const l = (b1 >> 1) & 3; // 1: III, 2: II, 3: I
    const version = v === 3 ? 1 : v === 2 ? 2 : v === 0 ? 25 : 0;
    const layer = l === 3 ? 1 : l === 2 ? 2 : l === 1 ? 3 : 0;
    const bi = (b2 >> 4) & 15;
    const ri = (b2 >> 2) & 3;
    if (!version || !layer || bi === 0 || bi === 15 || ri === 3) break;
    const kbps = BITRATES[`${version === 1 ? 1 : 2}-${layer}`]?.[bi - 1] ?? 0;
    const rate = RATES[version]?.[ri] ?? 0;
    const padding = (b2 >> 1) & 1;
    const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
    const length = layer === 1 ? Math.floor((12 * kbps * 1000) / rate + padding) * 4 : Math.floor(((samples / 8) * kbps * 1000) / rate) + padding;
    if (!kbps || !rate || length < 4) break;
    seconds += samples / rate;
    frames++;
    i += length;
  }
  return { ms: Math.round(seconds * 1000), frames };
}
