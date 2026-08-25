import type { Platform, Rule, RuleAction, RuleField } from '@shared/types'
import { useStore } from '../store'
import type { RuleEngine } from '../rules'

const FIELDS: { value: RuleField; label: string }[] = [
  { value: 'any', label: 'anywhere' },
  { value: 'author', label: 'author' },
  { value: 'text', label: 'message' }
]

const ACTIONS: { value: RuleAction; label: string }[] = [
  { value: 'highlight', label: 'highlight' },
  { value: 'hide', label: 'hide' }
]

const PLATFORMS: { value: Platform | ''; label: string }[] = [
  { value: '', label: 'all platforms' },
  { value: 'twitch', label: 'twitch' },
  { value: 'youtube', label: 'youtube' },
  { value: 'kick', label: 'kick' },
  { value: 'mock', label: 'mock' }
]

const selectClass =
  'rounded border border-[#2b323d] bg-[#0b0d10] px-1 py-[2px] text-[13px] text-slate-300 outline-none focus:border-indigo-500'

function RuleEditor({ rule, error }: { rule: Rule; error?: string }): React.ReactElement {
  const updateRule = useStore((s) => s.updateRule)
  const removeRule = useStore((s) => s.removeRule)

  return (
    <div className="rounded border border-[#232932] bg-[#171b22] p-2">
      <div className="mb-1 flex items-center gap-1">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
          title="enabled"
          className="cursor-pointer"
        />

        <select
          value={rule.action}
          onChange={(e) => updateRule(rule.id, { action: e.target.value as RuleAction })}
          className={selectClass}
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>

        <select
          value={rule.field}
          onChange={(e) => updateRule(rule.id, { field: e.target.value as RuleField })}
          className={selectClass}
        >
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {rule.action === 'highlight' && (
          <input
            type="color"
            value={rule.color ?? '#6366f1'}
            onChange={(e) => updateRule(rule.id, { color: e.target.value })}
            title="highlight colour"
            className="h-5 w-6 cursor-pointer rounded border border-[#2b323d] bg-transparent p-0"
          />
        )}

        <button
          type="button"
          onClick={() => removeRule(rule.id)}
          title="delete rule"
          className="ml-auto cursor-pointer rounded px-1 text-slate-500 hover:bg-red-500/20 hover:text-red-300"
        >
          ✕
        </button>
      </div>

      <input
        type="text"
        value={rule.pattern}
        placeholder={rule.isRegex ? 'regular expression' : 'text to match'}
        onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
        className={`w-full rounded border bg-[#0b0d10] px-1 py-[3px] text-[14px] outline-none ${
          error ? 'border-red-500/60 text-red-300' : 'border-[#2b323d] text-slate-200'
        } focus:border-indigo-500`}
      />

      {error && <div className="mt-1 text-[12px] text-red-400">{error}</div>}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            checked={rule.isRegex}
            onChange={(e) => updateRule(rule.id, { isRegex: e.target.checked })}
            className="cursor-pointer"
          />
          regex
        </label>
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            checked={rule.caseSensitive}
            onChange={(e) => updateRule(rule.id, { caseSensitive: e.target.checked })}
            className="cursor-pointer"
          />
          case
        </label>
        <select
          value={rule.platform ?? ''}
          onChange={(e) =>
            updateRule(rule.id, { platform: (e.target.value || undefined) as Platform | undefined })
          }
          className={`${selectClass} ml-auto`}
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function RulesPanel({ engine }: { engine: RuleEngine }): React.ReactElement {
  const rules = useStore((s) => s.rules)
  const addRule = useStore((s) => s.addRule)

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[#232932] bg-[#0f1216]">
      <div className="flex items-center justify-between border-b border-[#232932] px-2 py-[6px]">
        <span className="text-[13px] font-semibold tracking-wide text-slate-400 uppercase">
          Rules
        </span>
        <button
          type="button"
          onClick={() => addRule()}
          className="cursor-pointer rounded bg-indigo-600 px-2 py-[2px] text-[13px] font-medium text-white hover:bg-indigo-500"
        >
          + rule
        </button>
      </div>

      <div className="chat-scroll flex-1 space-y-2 overflow-y-auto p-2">
        {rules.length === 0 && (
          <p className="px-1 text-[13px] leading-relaxed text-slate-600">
            No rules yet. Highlight rules tint a message and colour its left border; hide rules
            drop it from every pane. Rules apply to scrollback too, so editing one re-styles
            messages already on screen.
          </p>
        )}

        {rules.map((rule) => (
          <RuleEditor key={rule.id} rule={rule} error={engine.errors[rule.id]} />
        ))}
      </div>
    </aside>
  )
}
