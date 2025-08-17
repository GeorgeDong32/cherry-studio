import { loggerService } from '@logger'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/config/constant'

const logger = loggerService.withContext('Utils:FileValidation')

/**
 * 文件上传验证工具
 * 结合扩展名检查和内容检测，提供更准确的文件类型判断
 */

/**
 * 检查文件扩展名是否为音视频文件
 * @param fileExtension 文件扩展名（包含点号，如 '.mp3'）
 * @returns 是否为音视频文件
 */
export function isAudioVideoExtension(fileExtension: string): boolean {
  const lowerExt = fileExtension.toLowerCase()
  return audioExts.includes(lowerExt) || videoExts.includes(lowerExt)
}

/**
 * 获取支持的文件扩展名列表
 * @param allowImages 是否允许图片文件
 * @returns 支持的扩展名数组
 */
export function getSupportedExtensions(allowImages: boolean = true): string[] {
  if (allowImages) {
    return [...imageExts, ...documentExts, ...textExts]
  }
  return [...documentExts, ...textExts]
}

/**
 * 基于扩展名检查文件是否被支持
 * @param fileExtension 文件扩展名（包含点号，如 '.txt'）
 * @param allowImages 是否允许图片文件
 * @returns 是否被支持
 */
export function isExtensionSupported(fileExtension: string, allowImages: boolean = true): boolean {
  const supportedExts = getSupportedExtensions(allowImages)
  return supportedExts.includes(fileExtension.toLowerCase())
}

/**
 * 基于文件内容检测文件是否为文本文件
 * 使用 IPC 调用 main 进程中的 istextorbinary 库
 * @param file File 对象
 * @returns Promise<boolean> 是否为文本文件
 */
export async function isTextFile(file: File): Promise<boolean> {
  try {
    // 读取文件内容并通过 IPC 发送到 main 进程进行检测
    const buffer = await file.arrayBuffer()

    // 调用 main 进程的文件检测服务
    return await window.api.fs.isTextContent(file.name, buffer)
  } catch (error) {
    logger.error('Error detecting file content type:', error as Error)
    return false
  }
}

/**
 * 综合验证文件是否可以上传
 * 优先使用扩展名检查，如果扩展名不在支持列表中，则使用内容检测
 * @param file File 对象
 * @param allowImages 是否允许图片文件
 * @returns Promise<{ allowed: boolean; reason?: string }> 验证结果
 */
export async function validateFileUpload(
  file: File,
  allowImages: boolean = true
): Promise<{ allowed: boolean; reason?: string }> {
  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase() || ''

  // 1. 首先检查扩展名是否在支持列表中
  if (isExtensionSupported(fileExtension, allowImages)) {
    return { allowed: true }
  }

  // 2. 明确排除音视频文件，即使 istextorbinary 可能错误识别
  // TODO: 若未来支持音视频文件上传，需调整此逻辑
  if (isAudioVideoExtension(fileExtension)) {
    return {
      allowed: false,
      reason: 'Audio and video files are not supported for upload'
    }
  }

  // 3. 如果扩展名不在支持列表中，也不是音视频文件，尝试内容检测
  const isTextContent = await isTextFile(file)

  if (isTextContent) {
    return {
      allowed: true,
      reason: 'File detected as text content via content analysis'
    }
  }

  // 4. 既不在扩展名列表中，内容也不是文本
  const supportedExts = getSupportedExtensions(allowImages)
  return {
    allowed: false,
    reason: `File type not supported. Supported extensions: ${supportedExts.join(', ')}`
  }
}

/**
 * 批量验证多个文件
 * @param files File 对象数组
 * @param allowImages 是否允许图片文件
 * @returns Promise<Array<{ file: File; allowed: boolean; reason?: string }>> 验证结果数组
 */
export async function validateMultipleFiles(
  files: File[],
  allowImages: boolean = true
): Promise<Array<{ file: File; allowed: boolean; reason?: string }>> {
  const results = await Promise.all(
    files.map(async (file) => {
      const validation = await validateFileUpload(file, allowImages)
      return {
        file,
        allowed: validation.allowed,
        reason: validation.reason
      }
    })
  )

  return results
}
