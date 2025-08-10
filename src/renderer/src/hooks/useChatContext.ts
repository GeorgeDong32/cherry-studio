import { loggerService } from '@logger'
import { useMessageOperations } from '@renderer/hooks/useMessageOperations'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { RootState } from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { setActiveTopic, setSelectedMessageIds, toggleMultiSelectMode } from '@renderer/store/runtime'
import { Topic } from '@renderer/types'
import { captureScrollableDiv } from '@renderer/utils/image'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector, useStore } from 'react-redux'

const logger = loggerService.withContext('useChatContext')

export const useChatContext = (activeTopic: Topic) => {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const store = useStore<RootState>()
  const { deleteMessage } = useMessageOperations(activeTopic)

  const [messageRefs, setMessageRefs] = useState<Map<string, HTMLElement>>(new Map())

  const isMultiSelectMode = useSelector((state: RootState) => state.runtime.chat.isMultiSelectMode)
  const selectedMessageIds = useSelector((state: RootState) => state.runtime.chat.selectedMessageIds)

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.CHANGE_TOPIC, () => {
      dispatch(toggleMultiSelectMode(false))
    })
    return () => unsubscribe()
  }, [dispatch])

  useEffect(() => {
    dispatch(setActiveTopic(activeTopic))
  }, [dispatch, activeTopic])

  const handleToggleMultiSelectMode = useCallback(
    (value: boolean) => {
      dispatch(toggleMultiSelectMode(value))
    },
    [dispatch]
  )

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    setMessageRefs((prev) => {
      const newRefs = new Map(prev)
      if (element) {
        newRefs.set(id, element)
      } else {
        newRefs.delete(id)
      }
      return newRefs
    })
  }, [])

  const locateMessage = useCallback(
    (messageId: string) => {
      const messageElement = messageRefs.get(messageId)
      if (messageElement) {
        // 检查消息是否可见
        const display = window.getComputedStyle(messageElement).display

        if (display === 'none') {
          // 如果消息隐藏，需要处理显示逻辑
          // 查找消息并设置为选中状态
          const state = store.getState()
          const messages = selectMessagesForTopic(state, activeTopic.id)
          const message = messages.find((m) => m.id === messageId)
          if (message) {
            // 这里需要实现设置消息为选中状态的逻辑
            // 可能需要调用其他函数或修改状态
          }
        }

        // 滚动到消息位置
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    [messageRefs, store, activeTopic.id]
  )

  const handleSelectMessage = useCallback(
    (messageId: string, selected: boolean) => {
      dispatch(
        setSelectedMessageIds(
          selected
            ? selectedMessageIds.includes(messageId)
              ? selectedMessageIds
              : [...selectedMessageIds, messageId]
            : selectedMessageIds.filter((id) => id !== messageId)
        )
      )
    },
    [dispatch, selectedMessageIds]
  )

  const handleMultiSelectAction = useCallback(
    async (actionType: string, messageIds: string[]) => {
      if (messageIds.length === 0) {
        window.message.warning(t('chat.multiple.select.empty'))
        return
      }

      const state = store.getState()
      const messages = selectMessagesForTopic(state, activeTopic.id)
      const messageBlocks = messageBlocksSelectors.selectEntities(state)

      switch (actionType) {
        case 'delete':
          window.modal.confirm({
            title: t('message.delete.confirm.title'),
            content: t('message.delete.confirm.content', { count: messageIds.length }),
            okButtonProps: { danger: true },
            centered: true,
            onOk: async () => {
              try {
                await Promise.all(messageIds.map((messageId) => deleteMessage(messageId)))
                window.message.success(t('message.delete.success'))
                handleToggleMultiSelectMode(false)
              } catch (error) {
                logger.error('Failed to delete messages:', error as Error)
                window.message.error(t('message.delete.failed'))
              }
            }
          })
          break
        case 'save': {
          // 筛选消息，实际并非assistant messages，而是可能包含user messages
          const assistantMessages = messages.filter((msg) => messageIds.includes(msg.id))
          if (assistantMessages.length > 0) {
            const contentToSave = assistantMessages
              .map((msg) => {
                return msg.blocks
                  .map((blockId) => {
                    const block = messageBlocks[blockId]
                    return block && 'content' in block ? block.content : ''
                  })
                  .filter(Boolean)
                  .join('\n')
                  .trim()
              })
              .join('\n\n---\n\n')
            const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`
            await window.api.file.save(fileName, contentToSave)
            window.message.success({ content: t('message.save.success.title'), key: 'save-messages' })
            handleToggleMultiSelectMode(false)
          } else {
            // 这个分支不会进入 因为 messageIds.length === 0 已提前返回，需要简化掉
          }
          break
        }
        case 'copy': {
          const assistantMessages = messages.filter((msg) => messageIds.includes(msg.id))
          if (assistantMessages.length > 0) {
            const contentToCopy = assistantMessages
              .map((msg) => {
                return msg.blocks
                  .map((blockId) => {
                    const block = messageBlocks[blockId]
                    return block && 'content' in block ? block.content : ''
                  })
                  .filter(Boolean)
                  .join('\n')
                  .trim()
              })
              .join('\n\n---\n\n')
            navigator.clipboard.writeText(contentToCopy)
            window.message.success({ content: t('message.copied'), key: 'copy-messages' })
            handleToggleMultiSelectMode(false)
          } else {
            // 和上面一样
          }
          break
        }
        case 'export_image': {
          // 获取选中的消息元素并导出为图片
          const selectedMessages = messages.filter((msg) => messageIds.includes(msg.id))
          if (selectedMessages.length > 0) {
            // 在try块外声明container变量，以便在finally块中可以访问
            let container: HTMLDivElement | null = null
            const clonedMessages: HTMLElement[] = []

            try {
              // 创建临时容器来包含选中的消息
              container = document.createElement('div')
              container.style.display = 'flex'
              container.style.flexDirection = 'column'
              container.style.gap = '16px'
              container.style.padding = '20px'
              container.style.background = 'var(--color-background)'
              container.style.minWidth = '800px'
              container.style.width = '800px'
              container.style.maxWidth = '800px'

              // 获取实际的消息DOM元素并克隆它们
              for (const msg of selectedMessages) {
                const originalElement = messageRefs.get(msg.id)
                if (originalElement) {
                  // 克隆原始元素
                  const clonedElement = originalElement.cloneNode(true) as HTMLElement

                  // 移除不需要的元素（如菜单栏等）
                  const menubars = clonedElement.querySelectorAll('.menubar')
                  menubars.forEach((bar) => bar.remove())

                  // 移除多选复选框
                  const checkboxes = clonedElement.querySelectorAll('input[type="checkbox"]')
                  checkboxes.forEach((checkbox) => checkbox.remove())

                  // 重置一些样式以确保正确显示
                  clonedElement.style.position = 'static'
                  clonedElement.style.transform = 'none'
                  clonedElement.style.willChange = 'auto'

                  // 添加到容器
                  container.appendChild(clonedElement)
                  clonedMessages.push(clonedElement)
                }
              }

              // 如果没有找到任何DOM元素，则回退到原始方法
              if (clonedMessages.length === 0) {
                // 添加每个选中的消息到容器中
                for (const msg of selectedMessages) {
                  // 直接创建消息元素而不是尝试获取DOM元素
                  const messageElement = document.createElement('div')
                  messageElement.style.padding = '12px'
                  messageElement.style.borderRadius = '8px'
                  messageElement.style.background = 'var(--color-background-soft)'
                  messageElement.style.marginBottom = '10px'
                  messageElement.style.width = '100%'
                  messageElement.style.maxWidth = '100%'

                  // 获取消息内容
                  const content = msg.blocks
                    .map((blockId) => {
                      const block = messageBlocks[blockId]
                      return block && 'content' in block ? block.content : ''
                    })
                    .filter(Boolean)
                    .join('\n')
                    .trim()

                  messageElement.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 8px;">
                      ${msg.role === 'user' ? 'User' : 'Assistant'}:
                    </div>
                    <div>${content}</div>
                  `
                  container.appendChild(messageElement)
                }
              }

              // 添加到文档中但隐藏
              container.style.position = 'absolute'
              container.style.left = '-9999px'
              container.style.top = '-9999px'
              container.style.visibility = 'hidden'
              document.body.appendChild(container)

              // 捕获为图片
              const canvas = await captureScrollableDiv({ current: container })
              if (canvas) {
                const imageData = canvas.toDataURL('image/png')
                const fileName = `chat_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`
                await window.api.file.saveImage(fileName, imageData)
                window.message.success({ content: t('message.export.image.success'), key: 'export-image-messages' })
              }
            } catch (error) {
              logger.error('Failed to export messages as image:', error as Error)
              window.message.error({ content: t('message.export.image.failed'), key: 'export-image-messages' })
            } finally {
              // 查找并移除所有临时添加的元素
              if (container && container.parentNode) {
                container.parentNode.removeChild(container)
              }
            }

            handleToggleMultiSelectMode(false)
          }
          break
        }
        default:
          break
      }
    },
    [store, activeTopic.id, t, handleToggleMultiSelectMode, deleteMessage, messageRefs]
  )

  return {
    isMultiSelectMode,
    selectedMessageIds,
    toggleMultiSelectMode: handleToggleMultiSelectMode,
    handleMultiSelectAction,
    handleSelectMessage,
    activeTopic,
    locateMessage,
    messageRefs,
    registerMessageElement
  }
}
