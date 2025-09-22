import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { MinAppType } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  sidebar?: boolean
  size?: number
  style?: React.CSSProperties
}

const MinAppIcon: FC<Props> = ({ app, size = 48, style, sidebar = false }) => {
  // First try to find in DEFAULT_MIN_APPS for predefined styling
  const _app = DEFAULT_MIN_APPS.find((item) => item.id === app.id)

  // If found in DEFAULT_MIN_APPS, use predefined styling
  if (_app) {
    return (
      <Container
        src={_app.logo}
        style={{
          border: _app.bodered ? '0.5px solid var(--color-border)' : 'none',
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: _app.background,
          ...(sidebar ? {} : app.style),
          ...style
        }}
      />
    )
  }

  // If not found in DEFAULT_MIN_APPS but app has logo, use it (for temporary apps)
  if (app.logo) {
    return (
      <Container
        src={app.logo}
        style={{
          border: 'none',
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: 'transparent',
          ...(sidebar ? {} : app.style),
          ...style
        }}
      />
    )
  }

  return null
}

const Container = styled.img`
  border-radius: 16px;
  user-select: none;
  -webkit-user-drag: none;
`

export default MinAppIcon
