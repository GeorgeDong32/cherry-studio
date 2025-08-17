import { describe, expect, test } from 'vitest'

import { isAudioVideoExtension, validateFileUpload } from '../fileValidation'

describe('Audio Video File Validation', () => {
  describe('isAudioVideoExtension', () => {
    test('should identify audio file extensions', () => {
      expect(isAudioVideoExtension('.mp3')).toBe(true)
      expect(isAudioVideoExtension('.MP3')).toBe(true)
      expect(isAudioVideoExtension('.wav')).toBe(true)
      expect(isAudioVideoExtension('.ogg')).toBe(true)
      expect(isAudioVideoExtension('.flac')).toBe(true)
      expect(isAudioVideoExtension('.aac')).toBe(true)
    })

    test('should identify video file extensions', () => {
      expect(isAudioVideoExtension('.mp4')).toBe(true)
      expect(isAudioVideoExtension('.MP4')).toBe(true)
      expect(isAudioVideoExtension('.avi')).toBe(true)
      expect(isAudioVideoExtension('.mov')).toBe(true)
      expect(isAudioVideoExtension('.wmv')).toBe(true)
      expect(isAudioVideoExtension('.flv')).toBe(true)
      expect(isAudioVideoExtension('.mkv')).toBe(true)
    })

    test('should not identify non-audio-video extensions', () => {
      expect(isAudioVideoExtension('.txt')).toBe(false)
      expect(isAudioVideoExtension('.js')).toBe(false)
      expect(isAudioVideoExtension('.png')).toBe(false)
      expect(isAudioVideoExtension('.pdf')).toBe(false)
    })
  })

  describe('validateFileUpload - Audio/Video Blocking', () => {
    test('should reject audio files', async () => {
      const audioFile = new File(['fake audio content'], 'test.mp3', { type: 'audio/mpeg' })
      const result = await validateFileUpload(audioFile, true)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Audio and video files are not supported')
    })

    test('should reject video files', async () => {
      const videoFile = new File(['fake video content'], 'test.mp4', { type: 'video/mp4' })
      const result = await validateFileUpload(videoFile, true)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Audio and video files are not supported')
    })

    test('should reject audio files with uppercase extensions', async () => {
      const audioFile = new File(['fake audio content'], 'TEST.MP3', { type: 'audio/mpeg' })
      const result = await validateFileUpload(audioFile, true)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Audio and video files are not supported')
    })

    test('should reject video files with uppercase extensions', async () => {
      const videoFile = new File(['fake video content'], 'TEST.MP4', { type: 'video/mp4' })
      const result = await validateFileUpload(videoFile, true)

      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Audio and video files are not supported')
    })
  })
})
