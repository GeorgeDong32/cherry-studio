import { TraceMethod } from '@mcp-trace/trace-core'
import fs from 'fs/promises'
import { isText } from 'istextorbinary'

import { loggerService } from './LoggerService'

const logger = loggerService.withContext('FileService')

export default class FileService {
  @TraceMethod({ spanName: 'readFile', tag: 'FileService' })
  public static async readFile(_: Electron.IpcMainInvokeEvent, pathOrUrl: string, encoding?: BufferEncoding) {
    const path = pathOrUrl.startsWith('file://') ? new URL(pathOrUrl) : pathOrUrl
    if (encoding) return fs.readFile(path, { encoding })
    return fs.readFile(path)
  }

  /**
   * 检测文件是否为文本文件
   * @param _ IPC event
   * @param filePath 文件路径
   * @returns Promise<boolean> 是否为文本文件
   */
  @TraceMethod({ spanName: 'isTextFile', tag: 'FileService' })
  public static async isTextFile(_: Electron.IpcMainInvokeEvent, filePath: string): Promise<boolean> {
    try {
      // 读取文件的前 8KB 用于检测（istextorbinary 建议的大小）
      const buffer = await fs.readFile(filePath, { flag: 'r' })
      const sampleSize = Math.min(8192, buffer.length)
      const sampleBuffer = buffer.subarray(0, sampleSize)

      // 使用 istextorbinary 检测文件内容
      return isText(filePath, sampleBuffer) === true
    } catch (error) {
      logger.error('Error detecting file content type:', error as Error)
      return false
    }
  }

  /**
   * 检测文件内容是否为文本（使用 Buffer 数据）
   * @param _ IPC event
   * @param fileName 文件名
   * @param fileBuffer 文件内容 Buffer
   * @returns Promise<boolean> 是否为文本文件
   */
  @TraceMethod({ spanName: 'isTextContent', tag: 'FileService' })
  public static async isTextContent(
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    fileBuffer: ArrayBuffer
  ): Promise<boolean> {
    try {
      const buffer = Buffer.from(fileBuffer)
      const sampleSize = Math.min(8192, buffer.length)
      const sampleBuffer = buffer.subarray(0, sampleSize)

      // 使用 istextorbinary 检测文件内容
      return isText(fileName, sampleBuffer) === true
    } catch (error) {
      logger.error('Error detecting file content type:', error as Error)
      return false
    }
  }
}
