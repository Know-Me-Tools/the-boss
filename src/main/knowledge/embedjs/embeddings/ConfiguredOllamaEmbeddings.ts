import { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'

type OllamaEmbeddingOptions = {
  model: string
  baseUrl: string
  keepAlive?: string
  requestOptions?: Record<string, unknown>
  dimensions?: number
}

export class ConfiguredOllamaEmbeddings extends BaseEmbeddings {
  private readonly model: string
  private readonly baseUrl: string
  private readonly keepAlive?: string
  private readonly requestOptions?: Record<string, unknown>
  private readonly configuredDimensions?: number

  constructor({ model, baseUrl, keepAlive, requestOptions, dimensions }: OllamaEmbeddingOptions) {
    super()
    this.model = model
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.keepAlive = keepAlive
    this.requestOptions = requestOptions
    this.configuredDimensions = dimensions
  }

  override async getDimensions(): Promise<number> {
    if (this.configuredDimensions) {
      return this.configuredDimensions
    }

    const sample = await this.embedDocuments(['sample'])
    return sample[0].length
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.post<{ embeddings?: number[][] }>('/api/embed', {
        model: this.model,
        input: texts.length === 1 ? texts[0] : texts,
        keep_alive: this.keepAlive,
        options: this.requestOptions
      })

      if (response.embeddings) {
        return response.embeddings
      }
    } catch {
      // Fall through to the legacy endpoint used by older Ollama servers.
    }

    return Promise.all(texts.map((text) => this.embedLegacy(text)))
  }

  override async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text])
    return embedding
  }

  private async embedLegacy(text: string): Promise<number[]> {
    const response = await this.post<{ embedding?: number[] }>('/api/embeddings', {
      model: this.model,
      prompt: text,
      keep_alive: this.keepAlive,
      options: this.requestOptions
    })

    if (!response.embedding) {
      throw new Error('Ollama legacy embedding response did not include an embedding')
    }

    return response.embedding
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`Ollama embedding request failed with status ${response.status}`)
    }

    return (await response.json()) as T
  }
}
