import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { ObsChat } from './ObsChat'
import { readOptions } from './options'

const options = readOptions(window.location)

if (options?.transparent) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {options ? (
      <ObsChat options={options} />
    ) : (
      <div className="p-3 text-neutral-400">
        Open this as <code>/chat/&lt;platform&gt;/&lt;channel&gt;</code> — copy the link from
        the chat's settings menu in stream-chat.
      </div>
    )}
  </StrictMode>
)
