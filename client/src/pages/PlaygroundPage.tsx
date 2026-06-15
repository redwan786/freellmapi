import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Paperclip, X, FileText } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { extractPdfText, renderPdfToImages } from '@/lib/pdf'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { Markdown } from '@/components/markdown'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  supportsVision: boolean
  keyCount: number
}

// An extracted PDF: the text is folded into the outbound message; name/pages
// drive the chip shown in the UI. Kept in history so multi-turn re-sends the
// document context.
interface PdfDoc {
  name: string
  pages: number
  text: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  // Data-URL images attached to a user turn (vision input). Kept in history so
  // the whole multimodal conversation is replayed on each send.
  images?: string[]
  docs?: PdfDoc[]
  meta?: {
    platform?: string
    model?: string
    latency?: number
    fallbackAttempts?: number
  }
}

// OpenAI multimodal content block, built only when a turn carries images.
type OutboundContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

// Images are base64-inlined into the JSON body; the server body limit is the
// effective ceiling, not a per-file cap here.
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

// Combine the typed text with any attached PDF text into a single string.
function buildText(msg: ChatMessage): string {
  let text = msg.content
  for (const doc of msg.docs ?? []) {
    text += `${text ? '\n\n' : ''}--- PDF: ${doc.name} (${doc.pages} page${doc.pages === 1 ? '' : 's'}) ---\n${doc.text}`
  }
  return text
}

// Build the outbound content for one message: a plain string when there are no
// images, otherwise the OpenAI multimodal array (text block first, then one
// image_url block per attachment). PDF text is folded into the text part.
function toOutboundContent(msg: ChatMessage): OutboundContent {
  const text = buildText(msg)
  if (!msg.images || msg.images.length === 0) return text
  const blocks: Exclude<OutboundContent, string> = []
  if (text) blocks.push({ type: 'text', text })
  for (const url of msg.images) blocks.push({ type: 'image_url', image_url: { url } })
  return blocks
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [docs, setDocs] = useState<PdfDoc[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('auto')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)
  // Image upload only makes sense when a vision-capable model can serve it.
  // When the user has pinned a specific model, gate on that model's capability;
  // for Auto, any enabled vision model in the chain will do.
  const hasVisionModel = availableModels.some(m => m.supportsVision)
  const pinnedSupportsVision = selectedModel === 'auto'
    ? hasVisionModel
    : availableModels.find(m => m.modelId === selectedModel)?.supportsVision ?? false
  const canAttach = pinnedSupportsVision

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addFiles = async (files: FileList | File[]) => {
    setAttachError(null)
    const all = Array.from(files)
    const pdfFiles = all.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    const imageFiles = all.filter(f => f.type.startsWith('image/'))

    // Images need a vision-capable model; PDFs are sent as text, so they're
    // always allowed.
    if (imageFiles.length > 0 && !canAttach) {
      setAttachError('Enable a vision-capable model to attach images (PDFs are fine).')
    } else if (imageFiles.length > 0) {
      try {
        const urls = await Promise.all(imageFiles.map(readFileAsDataUrl))
        setImages(prev => [...prev, ...urls])
      } catch (err: any) {
        setAttachError(err.message ?? 'Could not read image')
      }
    }

    if (pdfFiles.length > 0) {
      setParsing(true)
      try {
        for (const file of pdfFiles) {
          const { text, pages } = await extractPdfText(file)
          if (text) {
            setDocs(prev => [...prev, { name: file.name, pages, text }])
            continue
          }
          // No selectable text — a scanned/image PDF. Render its pages to
          // images and route them to a vision model instead. Needs one enabled.
          if (!canAttach) {
            setAttachError(`${file.name} is a scanned PDF (image-only). Enable a vision model to read it.`)
            continue
          }
          const { images: pageImages, pages: total, rendered } = await renderPdfToImages(file)
          if (pageImages.length === 0) {
            setAttachError(`${file.name} could not be read.`)
            continue
          }
          setImages(prev => [...prev, ...pageImages])
          if (rendered < total) {
            setAttachError(`${file.name} is a scanned PDF — sent the first ${rendered} of ${total} pages as images.`)
          }
        }
      } catch (err: any) {
        setAttachError(err.message ?? 'Could not read PDF')
      } finally {
        setParsing(false)
      }
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await addFiles(e.target.files)
    // Reset so picking the same file again still fires onChange.
    e.target.value = ''
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
    if (imageItems.length > 0) {
      e.preventDefault()
      if (!canAttach) {
        setAttachError('Enable a vision-capable model to attach images.')
        return
      }
      await addFiles(imageItems)
    }
  }

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  const removeDoc = (idx: number) => {
    setDocs(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && images.length === 0 && docs.length === 0) || loading) return

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      ...(images.length > 0 ? { images } : {}),
      ...(docs.length > 0 ? { docs } : {}),
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setImages([])
    setDocs([])
    setAttachError(null)
    setLoading(true)
    inputRef.current?.focus()

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const body: any = {
        messages: newMessages.map(m => ({ role: m.role, content: toOutboundContent(m) })),
      }
      if (selectedModel !== 'auto') body.model = selectedModel

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        setMessages([...newMessages, {
          role: 'assistant',
          content: `Error: ${err.error?.message ?? 'Unknown error'}`,
        }])
        return
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2)
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      setMessages([...newMessages, {
        role: 'assistant',
        content,
        meta: {
          platform: via?.platform,
          model: via?.model,
          latency,
          fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
        },
      }])
    } catch (err: any) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `Error: ${err.message}`,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    setImages([])
    setDocs([])
    setAttachError(null)
    inputRef.current?.focus()
  }

  const activeModelLabel = selectedModel === 'auto'
    ? 'Auto (fallback chain)'
    : availableModels.find(m => m.modelId === selectedModel)?.displayName ?? selectedModel

  const canSend = !loading && !parsing && (input.trim().length > 0 || images.length > 0 || docs.length > 0)

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] sm:h-[calc(100vh-8rem)]">
      <PageHeader
        title="Playground"
        description="Send a chat completion through the router and see which provider serves it."
        actions={
          <>
            <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? 'auto')}>
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (fallback chain)</SelectItem>
                {availableModels.map(m => (
                  <SelectItem key={m.modelDbId} value={m.modelId}>
                    <span className="flex items-center gap-2">
                      <span>{m.displayName}</span>
                      <span className="text-xs text-muted-foreground">{m.platform}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleClear}>
                Clear
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 flex flex-col rounded-3xl border bg-card overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <div className="space-y-2 max-w-sm">
                <p className="text-base font-medium">Send a message to get started.</p>
                <p className="text-sm text-muted-foreground">
                  Using <span className="text-foreground">{activeModelLabel}</span>. Switch models in the selector above.
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.images.map((src, j) => (
                          <img
                            key={j}
                            src={src}
                            alt={`attachment ${j + 1}`}
                            className="rounded-lg max-h-40 max-w-[200px] object-cover border border-black/10"
                          />
                        ))}
                      </div>
                    )}
                    {msg.docs && msg.docs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {msg.docs.map((doc, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-black/10 px-2 py-1 text-xs"
                          >
                            <FileText className="size-3.5" />
                            <span className="max-w-[160px] truncate">{doc.name}</span>
                            <span className="opacity-70">· {doc.pages}p</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.role === 'assistant' ? (
                      <Markdown>{msg.content}</Markdown>
                    ) : (
                      msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>
                    )}
                    {msg.meta && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] opacity-70 tabular-nums">
                        {msg.meta.platform && <span>{msg.meta.platform}</span>}
                        {msg.meta.model && <span className="font-mono">· {msg.meta.model}</span>}
                        {msg.meta.latency != null && <span>· {msg.meta.latency} ms</span>}
                        {msg.meta.fallbackAttempts != null && msg.meta.fallbackAttempts > 0 && (
                          <span>· {msg.meta.fallbackAttempts} fallback{msg.meta.fallbackAttempts > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="border-t bg-background/50 p-3">
          {/* Pending attachments preview */}
          {(images.length > 0 || docs.length > 0 || parsing) && (
            <div className="flex flex-wrap gap-2 mb-2 items-center">
              {images.map((src, i) => (
                <div key={`img-${i}`} className="relative group">
                  <img
                    src={src}
                    alt={`pending ${i + 1}`}
                    className="size-16 rounded-lg object-cover border"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="Remove image"
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-background border shadow-sm p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {docs.map((doc, i) => (
                <span
                  key={`doc-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-muted px-2 py-1.5 text-xs"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="max-w-[160px] truncate">{doc.name}</span>
                  <span className="text-muted-foreground">· {doc.pages}p</span>
                  <button
                    type="button"
                    onClick={() => removeDoc(i)}
                    aria-label="Remove PDF"
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              {parsing && <span className="text-xs text-muted-foreground">Reading PDF…</span>}
            </div>
          )}

          {attachError && (
            <p className="text-xs text-destructive mb-2">{attachError}</p>
          )}
          {!canAttach && (
            <p className="text-xs text-muted-foreground mb-2">
              {selectedModel === 'auto'
                ? 'No vision model enabled — images need one (enable it in the Fallback Chain). PDFs work with any model.'
                : 'The selected model has no vision support — images need Auto or a vision model. PDFs work with any model.'}
            </p>
          )}

          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={loading || parsing}
              title="Attach image or PDF"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Type a message… (⏎ to send, ⇧⏎ for newline)"
              rows={1}
              className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[40px] max-h-[160px]"
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={e => {
                const el = e.target as HTMLTextAreaElement
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 160) + 'px'
              }}
            />
            <Button onClick={handleSend} disabled={!canSend} size="default">
              {loading ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
