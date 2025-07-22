import { loggerService } from '@logger'
import { Client } from '@notionhq/client'
import i18n from '@renderer/i18n'
import { getMessageTitle } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { setExportState } from '@renderer/store/runtime'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { convertMathFormula, markdownToPlainText } from '@renderer/utils/markdown'
import { getCitationContent, getMainTextContent, getThinkingContent } from '@renderer/utils/messageUtils/find'
import { markdownToBlocks } from '@tryfabric/martian'
import dayjs from 'dayjs'
import { appendBlocks } from 'notion-helper' // 引入 notion-helper 的 appendBlocks 函数

const logger = loggerService.withContext('Utils:export')

/**
 * 获取话题的消息列表，使用TopicManager确保消息被正确加载
 * 这样可以避免从未打开过的话题导出为空的问题
 * @param topicId 话题ID
 * @returns 话题消息列表
 */
async function fetchTopicMessages(topicId: string): Promise<Message[]> {
  const { TopicManager } = await import('@renderer/hooks/useTopic')
  return await TopicManager.getTopicMessages(topicId)
}

/**
 * 从消息内容中提取标题，限制长度并处理换行和标点符号。用于导出功能。
 * @param {string} str 输入字符串
 * @param {number} [length=80] 标题最大长度，默认为 80
 * @returns {string} 提取的标题
 */
export function getTitleFromString(str: string, length: number = 80) {
  let title = str.trimStart().split('\n')[0]

  if (title.includes('。')) {
    title = title.split('。')[0]
  } else if (title.includes('，')) {
    title = title.split('，')[0]
  } else if (title.includes('.')) {
    title = title.split('.')[0]
  } else if (title.includes(',')) {
    title = title.split(',')[0]
  }

  if (title.length > length) {
    title = title.slice(0, length)
  }

  if (!title) {
    title = str.slice(0, length)
  }

  return title
}

const getRoleText = (role: string, modelName?: string, modelProvider?: string) => {
  const { showModelNameInMarkdown, showModelProviderInMarkdown } = store.getState().settings

  if (role === 'user') {
    return '🧑‍💻 User'
  } else if (role === 'system') {
    return '🤖 System'
  } else {
    let assistantText = '🤖 '
    if (showModelNameInMarkdown && modelName) {
      assistantText += `${modelName}`
      if (showModelProviderInMarkdown && modelProvider) {
        const providerDisplayName = i18n.t(`provider.${modelProvider}`, { defaultValue: modelProvider })
        assistantText += ` | ${providerDisplayName}`
        return assistantText
      }
      return assistantText
    } else if (showModelProviderInMarkdown && modelProvider) {
      const providerDisplayName = i18n.t(`provider.${modelProvider}`, { defaultValue: modelProvider })
      assistantText += `Assistant | ${providerDisplayName}`
      return assistantText
    }
    return assistantText + 'Assistant'
  }
}

/**
 * 移除文本中的引用标记
 * @param content 原始文本内容
 * @returns 移除引用标记后的文本
 */
const removeCitationMarks = (content: string): string => {
  // 移除各种形式的引用标记，但保留其他Markdown格式
  const result = content
    .replace(/\[<sup[^>]*data-citation[^>]*>\d+<\/sup>\]\([^)]*\)/g, '')
    .replace(/\[<sup[^>]*>\d+<\/sup>\]\([^)]*\)/g, '')
    .replace(/<sup[^>]*data-citation[^>]*>\d+<\/sup>/g, '')
    .replace(/\[(\d+)\](?!\()/g, '')

  const lines = result.split('\n')
  const processedLines = lines.map((line) => {
    if (line.match(/^```|^>|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s{4,}/)) {
      return line.replace(/[ ]+/g, ' ').replace(/[ ]+$/g, '')
    }
    return line.replace(/[ ]+/g, ' ').trim()
  })

  return processedLines.join('\n').trim()
}

const createBaseMarkdown = (message: Message, includeReasoning: boolean = false, excludeCitations: boolean = false) => {
  const { forceDollarMathInMarkdown } = store.getState().settings
  const roleText = getRoleText(message.role, message.model?.name, message.model?.provider)
  const titleSection = `### ${roleText}`
  let reasoningSection = ''

  if (includeReasoning) {
    let reasoningContent = getThinkingContent(message)
    if (reasoningContent) {
      if (reasoningContent.startsWith('<think>\n')) {
        reasoningContent = reasoningContent.substring(8)
      } else if (reasoningContent.startsWith('<think>')) {
        reasoningContent = reasoningContent.substring(7)
      }
      reasoningContent = reasoningContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '<br>')
      if (forceDollarMathInMarkdown) {
        reasoningContent = convertMathFormula(reasoningContent)
      }
      reasoningSection = `<div style="border: 2px solid #dddddd; border-radius: 10px;">
  <details style="padding: 5px;">
    <summary>${i18n.t('common.reasoning_content')}</summary>
    ${reasoningContent}
  </details>
</div>`
    }
  }

  const content = getMainTextContent(message)
  const citation = excludeCitations ? '' : getCitationContent(message)

  let processedContent = forceDollarMathInMarkdown ? convertMathFormula(content) : content

  // 如果排除引用，同时移除正文中的引用标记
  if (excludeCitations) {
    processedContent = removeCitationMarks(processedContent)
  }

  return { titleSection, reasoningSection, contentSection: processedContent, citation }
}

export const messageToMarkdown = (message: Message, excludeCitations?: boolean) => {
  const { excludeCitationsInExport } = store.getState().settings
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, contentSection, citation } = createBaseMarkdown(message, false, shouldExcludeCitations)
  return [titleSection, '', contentSection, citation].join('\n\n')
}

export const messageToMarkdownWithReasoning = (message: Message, excludeCitations?: boolean) => {
  const { excludeCitationsInExport } = store.getState().settings
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, reasoningSection, contentSection, citation } = createBaseMarkdown(
    message,
    true,
    shouldExcludeCitations
  )
  return [titleSection, '', reasoningSection + contentSection, citation].join('\n\n')
}

export const messagesToMarkdown = (messages: Message[], exportReasoning?: boolean, excludeCitations?: boolean) => {
  return messages
    .map((message) =>
      exportReasoning
        ? messageToMarkdownWithReasoning(message, excludeCitations)
        : messageToMarkdown(message, excludeCitations)
    )
    .join('\n\n---\n\n')
}

const formatMessageAsPlainText = (message: Message): string => {
  const roleText = message.role === 'user' ? 'User:' : 'Assistant:'
  const content = getMainTextContent(message)
  const plainTextContent = markdownToPlainText(content).trim()
  return `${roleText}\n${plainTextContent}`
}

export const messageToPlainText = (message: Message): string => {
  const content = getMainTextContent(message)
  return markdownToPlainText(content).trim()
}

const messagesToPlainText = (messages: Message[]): string => {
  return messages.map(formatMessageAsPlainText).join('\n\n')
}

export const topicToMarkdown = async (topic: Topic, exportReasoning?: boolean, excludeCitations?: boolean) => {
  const topicName = `# ${topic.name}`

  const messages = await fetchTopicMessages(topic.id)

  if (messages && messages.length > 0) {
    return topicName + '\n\n' + messagesToMarkdown(messages, exportReasoning, excludeCitations)
  }

  return topicName
}

export const topicToPlainText = async (topic: Topic): Promise<string> => {
  const topicName = markdownToPlainText(topic.name).trim()

  const topicMessages = await fetchTopicMessages(topic.id)

  if (topicMessages && topicMessages.length > 0) {
    return topicName + '\n\n' + messagesToPlainText(topicMessages)
  }

  return topicName
}

export const exportTopicAsMarkdown = async (topic: Topic, exportReasoning?: boolean, excludeCitations?: boolean) => {
  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(topic.name) + '.md'
      const markdown = await topicToMarkdown(topic, exportReasoning, excludeCitations)
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        window.message.success({
          content: i18n.t('message.success.markdown.export.specified'),
          key: 'markdown-success'
        })
      }
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.specified'), key: 'markdown-error' })
      logger.debug(error)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const fileName = removeSpecialCharactersForFileName(topic.name) + ` ${timestamp}.md`
      const markdown = await topicToMarkdown(topic, exportReasoning, excludeCitations)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.message.success({ content: i18n.t('message.success.markdown.export.preconf'), key: 'markdown-success' })
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.preconf'), key: 'markdown-error' })
      logger.debug(error)
    }
  }
}

export const exportMessageAsMarkdown = async (
  message: Message,
  exportReasoning?: boolean,
  excludeCitations?: boolean
) => {
  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + '.md'
      const markdown = exportReasoning
        ? messageToMarkdownWithReasoning(message, excludeCitations)
        : messageToMarkdown(message, excludeCitations)
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        window.message.success({
          content: i18n.t('message.success.markdown.export.specified'),
          key: 'markdown-success'
        })
      }
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.specified'), key: 'markdown-error' })
      logger.debug(error)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + ` ${timestamp}.md`
      const markdown = exportReasoning
        ? messageToMarkdownWithReasoning(message, excludeCitations)
        : messageToMarkdown(message, excludeCitations)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.message.success({ content: i18n.t('message.success.markdown.export.preconf'), key: 'markdown-success' })
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.preconf'), key: 'markdown-error' })
      logger.debug(error)
    }
  }
}

const convertMarkdownToNotionBlocks = async (markdown: string) => {
  return markdownToBlocks(markdown)
}

const convertThinkingToNotionBlocks = async (thinkingContent: string): Promise<any[]> => {
  if (!thinkingContent.trim()) {
    return []
  }

  const thinkingBlocks = [
    {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: '🤔 ' + i18n.t('common.reasoning_content')
            },
            annotations: {
              bold: true
            }
          }
        ],
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: thinkingContent
                  }
                }
              ]
            }
          }
        ]
      }
    }
  ]

  return thinkingBlocks
}

const executeNotionExport = async (title: string, allBlocks: any[]): Promise<any> => {
  const { isExporting } = store.getState().runtime.export
  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.notion.exporting'), key: 'notion-exporting' })
    return null
  }

  setExportState({ isExporting: true })

  title = title.slice(0, 29) + '...'

  const { notionDatabaseID, notionApiKey } = store.getState().settings
  if (!notionApiKey || !notionDatabaseID) {
    window.message.error({ content: i18n.t('message.error.notion.no_api_key'), key: 'notion-no-apikey-error' })
    setExportState({ isExporting: false })
    return null
  }

  try {
    const notion = new Client({ auth: notionApiKey })

    if (allBlocks.length === 0) {
      throw new Error('No content to export')
    }

    window.message.loading({
      content: i18n.t('message.loading.notion.preparing'),
      key: 'notion-preparing',
      duration: 0
    })
    let mainPageResponse: any = null
    let parentBlockId: string | null = null

    const response = await notion.pages.create({
      parent: { database_id: notionDatabaseID },
      properties: {
        [store.getState().settings.notionPageNameKey || 'Name']: {
          title: [{ text: { content: title } }]
        }
      }
    })
    mainPageResponse = response
    parentBlockId = response.id
    window.message.destroy('notion-preparing')
    window.message.loading({
      content: i18n.t('message.loading.notion.exporting_progress'),
      key: 'notion-exporting',
      duration: 0
    })
    if (allBlocks.length > 0) {
      await appendBlocks({
        block_id: parentBlockId,
        children: allBlocks,
        client: notion
      })
    }
    window.message.destroy('notion-exporting')
    window.message.success({ content: i18n.t('message.success.notion.export'), key: 'notion-success' })
    return mainPageResponse
  } catch (error: any) {
    window.message.error({ content: i18n.t('message.error.notion.export'), key: 'notion-export-progress' })
    logger.debug(error)
    return null
  } finally {
    setExportState({ isExporting: false })
  }
}

export const exportMessageToNotion = async (title: string, content: string, message?: Message) => {
  const { notionExportReasoning } = store.getState().settings

  const notionBlocks = await convertMarkdownToNotionBlocks(content)

  if (notionExportReasoning && message) {
    const thinkingContent = getThinkingContent(message)
    if (thinkingContent) {
      const thinkingBlocks = await convertThinkingToNotionBlocks(thinkingContent)
      if (notionBlocks.length > 0) {
        notionBlocks.splice(1, 0, ...thinkingBlocks)
      } else {
        notionBlocks.push(...thinkingBlocks)
      }
    }
  }

  return executeNotionExport(title, notionBlocks)
}

export const exportTopicToNotion = async (topic: Topic) => {
  const { notionExportReasoning, excludeCitationsInExport } = store.getState().settings

  const topicMessages = await fetchTopicMessages(topic.id)

  // 创建话题标题块
  const titleBlocks = await convertMarkdownToNotionBlocks(`# ${topic.name}`)

  // 为每个消息创建blocks
  const allBlocks: any[] = [...titleBlocks]

  for (const message of topicMessages) {
    // 将单个消息转换为markdown
    const messageMarkdown = messageToMarkdown(message, excludeCitationsInExport)
    const messageBlocks = await convertMarkdownToNotionBlocks(messageMarkdown)

    if (notionExportReasoning) {
      const thinkingContent = getThinkingContent(message)
      if (thinkingContent) {
        const thinkingBlocks = await convertThinkingToNotionBlocks(thinkingContent)
        if (messageBlocks.length > 0) {
          messageBlocks.splice(1, 0, ...thinkingBlocks)
        } else {
          messageBlocks.push(...thinkingBlocks)
        }
      }
    }

    allBlocks.push(...messageBlocks)
  }

  return executeNotionExport(topic.name, allBlocks)
}

export const exportMarkdownToYuque = async (title: string, content: string) => {
  const { isExporting } = store.getState().runtime.export
  const { yuqueToken, yuqueRepoId } = store.getState().settings

  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.yuque.exporting'), key: 'yuque-exporting' })
    return
  }

  if (!yuqueToken || !yuqueRepoId) {
    window.message.error({ content: i18n.t('message.error.yuque.no_config'), key: 'yuque-no-config-error' })
    return
  }

  setExportState({ isExporting: true })

  try {
    const response = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueRepoId}/docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': yuqueToken,
        'User-Agent': 'CherryAI'
      },
      body: JSON.stringify({
        title: title,
        slug: Date.now().toString(), // 使用时间戳作为唯一slug
        format: 'markdown',
        body: content
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    const doc_id = data.data.id

    const tocResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueRepoId}/toc`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': yuqueToken,
        'User-Agent': 'CherryAI'
      },
      body: JSON.stringify({
        action: 'appendNode',
        action_mode: 'sibling',
        doc_ids: [doc_id]
      })
    })

    if (!tocResponse.ok) {
      throw new Error(`HTTP error! status: ${tocResponse.status}`)
    }

    window.message.success({
      content: i18n.t('message.success.yuque.export'),
      key: 'yuque-success'
    })
    return data
  } catch (error: any) {
    logger.debug(error)
    window.message.error({
      content: i18n.t('message.error.yuque.export'),
      key: 'yuque-error'
    })
    return null
  } finally {
    setExportState({ isExporting: false })
  }
}

/**
 * 导出Markdown到Obsidian
 * @param attributes 文档属性
 * @param attributes.title 标题
 * @param attributes.created 创建时间
 * @param attributes.source 来源
 * @param attributes.tags 标签
 * @param attributes.processingMethod 处理方式
 * @param attributes.folder 选择的文件夹路径或文件路径
 * @param attributes.vault 选择的Vault名称
 */
export const exportMarkdownToObsidian = async (attributes: any) => {
  try {
    // 从参数获取Vault名称
    const obsidianVault = attributes.vault
    let obsidianFolder = attributes.folder || ''
    let isMarkdownFile = false

    if (!obsidianVault) {
      window.message.error(i18n.t('chat.topics.export.obsidian_no_vault_selected'))
      return
    }

    if (!attributes.title) {
      window.message.error(i18n.t('chat.topics.export.obsidian_title_required'))
      return
    }

    // 检查是否选择了.md文件
    if (obsidianFolder && obsidianFolder.endsWith('.md')) {
      isMarkdownFile = true
    }

    let filePath = ''

    // 如果是.md文件，直接使用该文件路径
    if (isMarkdownFile) {
      filePath = obsidianFolder
    } else {
      // 否则构建路径
      //构建保存路径添加以 / 结尾
      if (obsidianFolder && !obsidianFolder.endsWith('/')) {
        obsidianFolder = obsidianFolder + '/'
      }

      //构建文件名
      const fileName = transformObsidianFileName(attributes.title)
      filePath = obsidianFolder + fileName + '.md'
    }

    let obsidianUrl = `obsidian://new?file=${encodeURIComponent(filePath)}&vault=${encodeURIComponent(obsidianVault)}&clipboard`

    if (attributes.processingMethod === '3') {
      obsidianUrl += '&overwrite=true'
    } else if (attributes.processingMethod === '2') {
      obsidianUrl += '&prepend=true'
    } else if (attributes.processingMethod === '1') {
      obsidianUrl += '&append=true'
    }

    window.open(obsidianUrl)
    window.message.success(i18n.t('chat.topics.export.obsidian_export_success'))
  } catch (error) {
    logger.error('导出到Obsidian失败:', error as Error)
    window.message.error(i18n.t('chat.topics.export.obsidian_export_failed'))
  }
}

/**
 * 生成Obsidian文件名,源自 Obsidian  Web Clipper 官方实现,修改了一些细节
 * @param fileName
 * @returns
 */
function transformObsidianFileName(fileName: string): string {
  const platform = window.navigator.userAgent
  const isWin = /win/i.test(platform)
  const isMac = /mac/i.test(platform)

  // 删除Obsidian 全平台无效字符
  let sanitized = fileName.replace(/[#|\\^\\[\]]/g, '')

  if (isWin) {
    // Windows 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '_$1$2') // 避免保留名称
      .replace(/[\s.]+$/, '') // 移除结尾的空格和句点
  } else if (isMac) {
    // Mac 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^\./, '_') // 避免以句点开头
  } else {
    // Linux 或其他系统
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^\./, '_') // 避免以句点开头
  }

  // 所有平台的通用操作
  sanitized = sanitized
    .replace(/^\.+/, '') // 移除开头的句点
    .trim() // 移除前后空格
    .slice(0, 245) // 截断为 245 个字符，留出空间以追加 ' 1.md'

  // 确保文件名不为空
  if (sanitized.length === 0) {
    sanitized = 'Untitled'
  }

  return sanitized
}

export const exportMarkdownToJoplin = async (title: string, contentOrMessages: string | Message | Message[]) => {
  const { joplinUrl, joplinToken, joplinExportReasoning, excludeCitationsInExport } = store.getState().settings

  if (!joplinUrl || !joplinToken) {
    window.message.error(i18n.t('message.error.joplin.no_config'))
    return
  }

  let content: string
  if (typeof contentOrMessages === 'string') {
    content = contentOrMessages
  } else if (Array.isArray(contentOrMessages)) {
    content = messagesToMarkdown(contentOrMessages, joplinExportReasoning, excludeCitationsInExport)
  } else {
    // 单条Message
    content = joplinExportReasoning
      ? messageToMarkdownWithReasoning(contentOrMessages, excludeCitationsInExport)
      : messageToMarkdown(contentOrMessages, excludeCitationsInExport)
  }

  try {
    const baseUrl = joplinUrl.endsWith('/') ? joplinUrl : `${joplinUrl}/`
    const response = await fetch(`${baseUrl}notes?token=${joplinToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        body: content,
        source: 'Cherry Studio'
      })
    })

    if (!response.ok) {
      throw new Error('service not available')
    }

    const data = await response.json()
    if (data?.error) {
      throw new Error('response error')
    }

    window.message.success(i18n.t('message.success.joplin.export'))
    return
  } catch (error: any) {
    window.message.error(i18n.t('message.error.joplin.export'))
    logger.debug(error)
    return
  }
}

/**
 * 导出Markdown到思源笔记
 * @param title 笔记标题
 * @param content 笔记内容
 */
export const exportMarkdownToSiyuan = async (title: string, content: string) => {
  const { isExporting } = store.getState().runtime.export
  const { siyuanApiUrl, siyuanToken, siyuanBoxId, siyuanRootPath } = store.getState().settings

  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.siyuan.exporting'), key: 'siyuan-exporting' })
    return
  }

  if (!siyuanApiUrl || !siyuanToken || !siyuanBoxId) {
    window.message.error({ content: i18n.t('message.error.siyuan.no_config'), key: 'siyuan-no-config-error' })
    return
  }

  setExportState({ isExporting: true })

  try {
    // test connection
    const testResponse = await fetch(`${siyuanApiUrl}/api/notebook/lsNotebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${siyuanToken}`
      }
    })

    if (!testResponse.ok) {
      throw new Error('API请求失败')
    }

    const testData = await testResponse.json()
    if (testData.code !== 0) {
      throw new Error(`${testData.msg || i18n.t('message.error.unknown')}`)
    }

    // 确保根路径以/开头
    const rootPath = siyuanRootPath?.startsWith('/') ? siyuanRootPath : `/${siyuanRootPath || 'CherryStudio'}`
    const renderedRootPath = await renderSprigTemplate(siyuanApiUrl, siyuanToken, rootPath)
    // 创建文档
    const docTitle = `${title.replace(/[#|\\^\\[\]]/g, '')}`
    const docPath = `${renderedRootPath}/${docTitle}`

    // 创建文档
    await createSiyuanDoc(siyuanApiUrl, siyuanToken, siyuanBoxId, docPath, content)

    window.message.success({
      content: i18n.t('message.success.siyuan.export'),
      key: 'siyuan-success'
    })
  } catch (error) {
    logger.error('导出到思源笔记失败:', error as Error)
    window.message.error({
      content: i18n.t('message.error.siyuan.export') + (error instanceof Error ? `: ${error.message}` : ''),
      key: 'siyuan-error'
    })
  } finally {
    setExportState({ isExporting: false })
  }
}
/**
 * 渲染 思源笔记 Sprig 模板字符串
 * @param apiUrl 思源 API 地址
 * @param token 思源 API Token
 * @param template Sprig 模板
 * @returns 渲染后的字符串
 */
async function renderSprigTemplate(apiUrl: string, token: string, template: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/template/renderSprig`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`
    },
    body: JSON.stringify({ template })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`${data.msg || i18n.t('message.error.unknown')}`)
  }

  return data.data
}

/**
 * 创建思源笔记文档
 */
async function createSiyuanDoc(
  apiUrl: string,
  token: string,
  boxId: string,
  path: string,
  markdown: string
): Promise<string> {
  const response = await fetch(`${apiUrl}/api/filetree/createDocWithMd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`
    },
    body: JSON.stringify({
      notebook: boxId,
      path: path,
      markdown: markdown
    })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`${data.msg || i18n.t('message.error.unknown')}`)
  }

  return data.data
}
