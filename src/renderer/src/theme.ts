import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

export const INK = {
  app: '#0b0d10',
  chat: '#12151a',
  card: '#171b22',
  raised: '#1f242d',
  chrome: '#0f1216',
  line: '#232932'
}

const PRIMARY = '#6366f1'

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

    colorText: '#d7dce3',
    colorTextSecondary: '#9aa4b2',
    colorTextTertiary: '#79838f',

    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    borderRadius: 4,
    controlHeight: 28
  },

  components: {
    Layout: {
      bodyBg: INK.chat
    },
    Empty: {
      colorTextDescription: '#6b7686'
    },
    Tabs: {
      horizontalMargin: '0',
      cardBg: INK.app,
      itemColor: '#9aa4b2',
      itemSelectedColor: '#e6ebf2',
      itemHoverColor: '#e6ebf2'
    }
  }
}
