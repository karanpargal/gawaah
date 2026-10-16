import { LIMITS } from "../arkiv/schema"

/** A rectangle to pixelate, in fractions of the image (0–1) so it survives resizing. */
export type Redaction = { x: number; y: number; w: number; h: number }

export type PreparedPhoto = { bytes: Uint8Array; url: string; width: number; height: number }

/**
 * Re-draws the photo on a canvas and re-encodes it as a fresh JPEG. Nothing from the original
 * file survives except pixels: no EXIF, no GPS, no camera serial, no timestamps. Redacted areas
 * are pixelated in the canvas before encoding, so the original pixels never leave the device.
 */
export async function preparePhoto(file: Blob, redactions: Redaction[]): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    for (const maxSide of [1280, 1024, 800, 640, 480]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      const w = Math.round(bitmap.width * scale)
      const h = Math.round(bitmap.height * scale)
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(bitmap, 0, 0, w, h)
      for (const r of redactions) pixelate(ctx, r, w, h)

      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality))
        if (blob && blob.size <= LIMITS.mediaBytes) {
          return {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            url: URL.createObjectURL(blob),
            width: w,
            height: h,
          }
        }
      }
    }
    throw new Error("Couldn't shrink this photo under the size limit.")
  } finally {
    bitmap.close()
  }
}

function pixelate(ctx: CanvasRenderingContext2D, r: Redaction, w: number, h: number) {
  const x = Math.max(0, Math.floor(r.x * w))
  const y = Math.max(0, Math.floor(r.y * h))
  const rw = Math.min(w - x, Math.ceil(r.w * w))
  const rh = Math.min(h - y, Math.ceil(r.h * h))
  if (rw < 2 || rh < 2) return
  // Blocks big enough that a face can't be recovered by upscaling.
  const block = Math.max(12, Math.round(Math.max(rw, rh) / 6))
  const img = ctx.getImageData(x, y, rw, rh)
  for (let by = 0; by < rh; by += block) {
    for (let bx = 0; bx < rw; bx += block) {
      let rs = 0, gs = 0, bs = 0, n = 0
      for (let yy = by; yy < Math.min(by + block, rh); yy++) {
        for (let xx = bx; xx < Math.min(bx + block, rw); xx++) {
          const i = (yy * rw + xx) * 4
          rs += img.data[i]!
          gs += img.data[i + 1]!
          bs += img.data[i + 2]!
          n++
        }
      }
      ctx.fillStyle = `rgb(${rs / n | 0},${gs / n | 0},${bs / n | 0})`
      ctx.fillRect(x + bx, y + by, Math.min(block, rw - bx), Math.min(block, rh - by))
    }
  }
}

export function bytesToUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }))
}
