import { describe, expect, test, vi } from 'vitest'

import { getSupportedExtensions, validateFileMetadata, validateFileUpload } from '../fileValidation'

// Mock window.api for testing
const mockApi = {
  fs: {
    isTextContent: vi.fn()
  },
  file: {
    get: vi.fn()
  }
}

// @ts-ignore - Mock global window.api
global.window = {
  api: mockApi
} as any

// Create a custom File mock that has arrayBuffer method
class MockFile {
  name: string
  type: string
  size: number
  private data: any

  constructor(data: any, name: string, options: { type?: string } = {}) {
    this.data = data
    this.name = name
    this.type = options.type || ''
    this.size = Array.isArray(data) ? data.length : data.byteLength || 0
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.data instanceof ArrayBuffer) {
      return this.data
    }
    if (this.data instanceof Uint8Array) {
      // Create a new ArrayBuffer and copy the data
      const buffer = new ArrayBuffer(this.data.length)
      const view = new Uint8Array(buffer)
      view.set(this.data)
      return buffer
    }
    // Convert string to ArrayBuffer
    const encoder = new TextEncoder()
    const uint8Array = encoder.encode(String(this.data))
    const buffer = new ArrayBuffer(uint8Array.length)
    const view = new Uint8Array(buffer)
    view.set(uint8Array)
    return buffer
  }
}

// Replace global File with our mock for testing
global.File = MockFile as any

describe('File Validation', () => {
  describe('getSupportedExtensions', () => {
    test('should return extensions with images when allowImages is true', () => {
      const extensions = getSupportedExtensions(true)
      expect(extensions).toContain('.png')
      expect(extensions).toContain('.jpg')
      expect(extensions).toContain('.txt')
      expect(extensions).toContain('.pdf')
    })

    test('should return extensions without images when allowImages is false', () => {
      const extensions = getSupportedExtensions(false)
      expect(extensions).not.toContain('.png')
      expect(extensions).not.toContain('.jpg')
      expect(extensions).toContain('.txt')
      expect(extensions).toContain('.pdf')
    })
  })

  describe('validateFileUpload', () => {
    test('should allow supported file extensions', async () => {
      const jsFile = new File(['console.log("test")'], 'test.js', { type: 'text/javascript' })
      const result = await validateFileUpload(jsFile, false)

      expect(result.allowed).toBe(true)
    })

    test('should use content detection for unknown extensions', async () => {
      mockApi.fs.isTextContent.mockResolvedValue(true)

      const unknownFile = new File(['This is text content'], 'test.unknown', { type: 'text/plain' })
      const result = await validateFileUpload(unknownFile, false)

      expect(result.allowed).toBe(true)
      expect(result.reason).toContain('text content via content analysis')
      expect(mockApi.fs.isTextContent).toHaveBeenCalledWith('test.unknown', expect.any(ArrayBuffer))
    })

    test('should reject unsupported file types', async () => {
      mockApi.fs.isTextContent.mockResolvedValue(false)

      const unknownFile = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.unknown', {
        type: 'application/octet-stream'
      })
      const result = await validateFileUpload(unknownFile, false)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('File type not supported')
    })
  })

  describe('validateFileMetadata', () => {
    test('should validate file metadata successfully', async () => {
      mockApi.file.get.mockResolvedValue('This is test content')
      mockApi.fs.isTextContent.mockResolvedValue(true)

      const fileMetadata = {
        id: 'test-id',
        ext: '.unknown',
        origin_name: 'test.unknown',
        path: '/path/to/test.unknown'
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(result.allowed).toBe(true)
      expect(result.reason).toContain('text content via content analysis')
      expect(mockApi.file.get).toHaveBeenCalledWith('/path/to/test.unknown')
    })

    test('should handle file read errors gracefully', async () => {
      mockApi.file.get.mockRejectedValue(new Error('File not found'))

      const fileMetadata = {
        id: 'test-id',
        ext: '.txt',
        origin_name: 'test.txt'
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Failed to read file: File not found')
    })

    test('should use id + ext as fallback path', async () => {
      mockApi.file.get.mockResolvedValue('Text content')
      mockApi.fs.isTextContent.mockResolvedValue(false)

      const fileMetadata = {
        id: 'test-id',
        ext: '.unknown',
        origin_name: 'test.unknown'
        // no path provided
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(mockApi.file.get).toHaveBeenCalledWith('test-id.unknown')
      expect(result.allowed).toBe(false)
    })

    test('should handle invalid file metadata gracefully', async () => {
      const fileMetadata = {
        id: '',
        ext: '.txt',
        origin_name: 'test.txt'
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Invalid file metadata: missing file identifier')
    })

    test('should handle invalid file paths', async () => {
      const fileMetadata = {
        id: 'test<>:|"?*',
        ext: '.txt',
        origin_name: 'test.txt'
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Invalid file path format')
    })

    test('should handle path length limit', async () => {
      const longId = 'a'.repeat(300) // Exceeds 260 char limit
      const fileMetadata = {
        id: longId,
        ext: '.txt',
        origin_name: 'test.txt'
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Invalid file path format')
    })

    test('should normalize extension correctly', async () => {
      // Clear previous mock calls
      mockApi.file.get.mockClear()
      mockApi.fs.isTextContent.mockClear()

      mockApi.file.get.mockResolvedValue('Text content')
      mockApi.fs.isTextContent.mockResolvedValue(true)

      const fileMetadata = {
        id: 'test-file',
        ext: 'txt', // without leading dot
        origin_name: 'test.txt'
      }

      const result = await validateFileMetadata(fileMetadata, false)

      expect(mockApi.file.get).toHaveBeenCalledWith('test-file.txt')
      expect(result.allowed).toBe(true)
    })
  })
})
