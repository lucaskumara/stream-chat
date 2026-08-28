import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

export const INK = {
  app: '#0d0d0d',
  chat: '#141414',
  card: '#1c1c1c',
  raised: '#242424',
  chrome: '#101010',
  line: '#272727'
}

const PRIMARY = '#5c5c5c'

export const chatTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,

  token: {
    colorPrimary: PRIMARY,
    colorInfo: PRIMARY,

    colorBgBase: INK.app,
    colorBgContainer: INK.card,
    colorBgElevated: INK.raised,
    colorBorder: INK.line,
    colorBorderSecondary: INK.line,

    colorText: '#e3e3e3',
    colorTextSecondary: '#a1a1a1',
    colorTextTertiary: '#7a7a7a',

    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,
    borderRadius: 4,
    controlHeight: 28
  },

  components: {
    Layout: {
      bodyBg: INK.chat
    },
    Empty: {
      colorTextDescription: '#6b6b6b'
    },
    Tabs: {
      horizontalMargin: '0',
      cardBg: INK.app,
      itemColor: '#a1a1a1',
      itemSelectedColor: '#ededed',
      itemHoverColor: '#ededed'
    }
  }
}
