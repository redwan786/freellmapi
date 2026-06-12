import * as pdfjsLib from 'pdfjs-dist'
// Vite resolves this to a hashed asset URL at build time; pdf.js runs its
// parser off the main thread via this worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// Extract plain text from a PDF in the browser. These chat models don't accept
// raw PDFs, so we pull the text out client-side and send it as a text block.
export async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const parts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ')
    parts.push(pageText)
  }
  return { text: parts.join('\n\n').trim(), pages: pdf.numPages }
}

// Render PDF pages to JPEG data URLs. The fallback for scanned/image PDFs that
// carry no extractable text: each page becomes an image sent to a vision model.
// By default every page is rendered (no cap). Pages are downscaled so the
// longest side is at most maxDimension and encoded as moderate-quality JPEG, so
// even a long document stays a reasonable request size.
export async function renderPdfToImages(
  file: File,
  { maxPages = Infinity, maxDimension = 1500, quality = 0.6 }:
    { maxPages?: number; maxDimension?: number; quality?: number } = {},
): Promise<{ images: string[]; pages: number; rendered: number }> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const total = pdf.numPages
  const rendered = Math.min(total, maxPages)
  const images: string[] = []
  for (let i = 1; i <= rendered; i++) {
    const page = await pdf.getPage(i)
    // Pick a scale so the longest side lands near maxDimension (never upscale).
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(maxDimension / Math.max(base.width, base.height), 2)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Could not get a 2D canvas context to render the PDF')
    await page.render({ canvas, canvasContext, viewport }).promise
    images.push(canvas.toDataURL('image/jpeg', quality))
  }
  return { images, pages: total, rendered }
}
