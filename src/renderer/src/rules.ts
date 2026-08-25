import type { ChatMessage, Rule } from '@shared/types'

export interface Decision {
  hidden: boolean
  highlight?: string
}

const CLEAN: Decision = { hidden: false }

/** Bound on the memo cache; messages are evicted from the ring buffer anyway. */
const CACHE_LIMIT = 8000

interface Compiled {
  rule: Rule
  test: (msg: ChatMessage) => boolean
}

export interface RuleEngine {
  evaluate(msg: ChatMessage): Decision
  /** ruleId -> message, for rules whose regex failed to compile. */
  errors: Record<string, string>
}

function subjectFor(rule: Rule, msg: ChatMessage): string {
  switch (rule.field) {
    case 'author':
      return `${msg.authorName} ${msg.authorDisplayName ?? ''}`
    case 'text':
      return msg.plainText
    case 'any':
      return `${msg.authorName} ${msg.authorDisplayName ?? ''} ${msg.plainText}`
  }
}

function compile(rules: Rule[]): { compiled: Compiled[]; errors: Record<string, string> } {
  const compiled: Compiled[] = []
  const errors: Record<string, string> = {}

  for (const rule of rules) {
    if (!rule.enabled || rule.pattern.trim() === '') continue

    if (rule.isRegex) {
      let re: RegExp
      try {
        re = new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i')
      } catch (err) {
        // A half-typed regex is the normal state of a text input, so a bad
        // pattern disables just that rule instead of breaking the whole feed.
        errors[rule.id] = err instanceof Error ? err.message : 'invalid regex'
        continue
      }
      compiled.push({
        rule,
        test: (msg) => {
          re.lastIndex = 0
          return re.test(subjectFor(rule, msg))
        }
      })
      continue
    }

    const needle = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase()
    compiled.push({
      rule,
      test: (msg) => {
        const subject = subjectFor(rule, msg)
        return (rule.caseSensitive ? subject : subject.toLowerCase()).includes(needle)
      }
    })
  }

  return { compiled, errors }
}

/**
 * Rules are evaluated lazily per message and memoised by message id. Messages
 * are immutable once received, so the cache is only invalidated by building a
 * new engine — which is exactly what happens when the rule list changes.
 */
export function createRuleEngine(rules: Rule[]): RuleEngine {
  const { compiled, errors } = compile(rules)
  const cache = new Map<string, Decision>()

  const hasRules = compiled.length > 0

  return {
    errors,
    evaluate(msg) {
      if (!hasRules) return CLEAN

      const cached = cache.get(msg.id)
      if (cached) return cached

      let hidden = false
      let highlight: string | undefined

      for (const { rule, test } of compiled) {
        if (rule.platform && rule.platform !== msg.platform) continue
        if (!test(msg)) continue

        if (rule.action === 'hide') {
          hidden = true
          break
        }
        highlight ??= rule.color ?? '#6366f1'
      }

      const decision: Decision = highlight ? { hidden, highlight } : { hidden }

      if (cache.size >= CACHE_LIMIT) cache.clear()
      cache.set(msg.id, decision)
      return decision
    }
  }
}
