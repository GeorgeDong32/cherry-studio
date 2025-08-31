import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MinApp/WebviewContainer'
import { useSettings } from '@renderer/hooks/useSettings'
import { MinAppType } from '@renderer/types'
import { Avatar } from 'antd'
import { WebviewTag } from 'electron'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import MinimalToolbar from './MinimalToolbar'

const logger = loggerService.withContext('MinAppFullPageView')

interface Props {
  app: MinAppType
}

// Persistent storage for WebView loaded states (similar to MinappPopupContainer)
const webviewLoadedStates = new Map<string, boolean>()

const MinAppFullPageView: FC<Props> = ({ app }) => {
  const webviewRef = useRef<WebviewTag | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const { minappsOpenLinkExternal } = useSettings()

  // Debug: log isReady state changes
  useEffect(() => {
    logger.debug(`isReady state changed to: ${isReady}`)
  }, [isReady])

  // Initialize when app changes - smart loading state detection
  useEffect(() => {
    setCurrentUrl(app.url)

    // Check if this WebView has been loaded before (keep-alive state)
    if (webviewLoadedStates.get(app.id)) {
      logger.debug(`App ${app.id} already loaded before, setting ready immediately`)
      setIsReady(true)
      return // No cleanup needed for immediate ready state
    } else {
      logger.debug(`App ${app.id} not loaded before, showing loading state`)
      setIsReady(false)

      // Commented out backup timer as requested - let loading animation show indefinitely if needed
      // const timer = setTimeout(() => {
      //   logger.debug('Backup timer: setting isReady to true for new WebView')
      //   setIsReady(true)
      // }, 3000)
      // return () => clearTimeout(timer)
    }
  }, [app])

  const handleWebviewSetRef = useCallback((_appId: string, element: WebviewTag | null) => {
    webviewRef.current = element
    if (element) {
      logger.debug('WebView element set')
    }
  }, [])

  const handleWebviewLoaded = useCallback(
    (appId: string) => {
      logger.debug(`WebView loaded for app: ${appId}`)
      const webviewId = webviewRef.current?.getWebContentsId()
      if (webviewId) {
        window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
      }

      // Mark this WebView as loaded for future use
      webviewLoadedStates.set(appId, true)

      // Use small delay like MinappPopupContainer (100ms) to ensure content is visible
      if (appId === app.id) {
        setTimeout(() => {
          logger.debug(`WebView loaded callback: setting isReady to true for ${appId}`)
          setIsReady(true)
        }, 100)
      }
    },
    [minappsOpenLinkExternal, app.id]
  )

  const handleWebviewNavigate = useCallback((_appId: string, url: string) => {
    logger.debug(`URL changed: ${url}`)
    setCurrentUrl(url)
  }, [])

  const handleReload = useCallback(() => {
    if (webviewRef.current) {
      // Clear the loaded state for this app since we're reloading
      webviewLoadedStates.delete(app.id)
      setIsReady(false) // Set loading state when reloading
      webviewRef.current.src = app.url

      // fallback timer in case did-finish-load doesn't fire (commented out as per request)
      // setTimeout(() => {
      //   logger.debug('Reload backup timer: setting isReady to true')
      //   setIsReady(true)
      // }, 4000)
    }
  }, [app.url, app.id])

  const handleOpenDevTools = useCallback(() => {
    if (webviewRef.current) {
      webviewRef.current.openDevTools()
    }
  }, [])

  return (
    <Container>
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={currentUrl}
        onReload={handleReload}
        onOpenDevTools={handleOpenDevTools}
      />

      <WebviewArea>
        {!isReady && (
          <LoadingOverlay>
            <Avatar src={app.logo} size={60} style={{ border: '1px solid var(--color-border)' }} />
            <BeatLoader color="var(--color-text-2)" size={8} style={{ marginTop: 12 }} />
          </LoadingOverlay>
        )}

        <WebviewContainer
          key={app.id}
          appid={app.id}
          url={app.url}
          onSetRefCallback={handleWebviewSetRef}
          onLoadedCallback={handleWebviewLoaded}
          onNavigateCallback={handleWebviewNavigate}
        />
      </WebviewArea>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const WebviewArea = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: var(--color-background);
`

const LoadingOverlay = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 10;
  pointer-events: none;
`

export default MinAppFullPageView
