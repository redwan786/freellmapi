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
