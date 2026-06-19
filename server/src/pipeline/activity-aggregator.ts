import type { ActivityEvent } from './activity.types'

/** 单个活动条目的细节(think/tool/stage),与 FE 的 ActivityDetail 同款。 */
export interface ActivityDetail {
  act: 'think' | 'tool' | 'stage'
  label?: string
  text?: string
  toolArgs?: unknown
  toolResult?: unknown
  status?: 'ok' | 'error'
  summary?: string
}
export type ActivityMap = Record<string, ActivityDetail>

export interface AggregatedTurn {
  contentMarkdown: string
  activities: ActivityMap
}

/**
 * 把一轮扁平 ActivityEvent 流聚合成 { contentMarkdown, activitiesLookup }。
 * content 的正文直接进 markdown 串;think/tool/stage 只插 leaf 指令标记,
 * 细节存进查找表。FE 流式构建与此同构(见 useAIStreamHandler Act* 分支)。
 *
 * contentMarkdown 里 think/tool/stage 的标记语法必须与 FE 完全一致:
 *   ::think{id="<id>"}  ::tool{id="<id>"}  ::stage{id="<id>"}
 */
export function aggregateActivities(events: ActivityEvent[]): AggregatedTurn {
  let contentMarkdown = ''
  const activities: ActivityMap = {}

  for (const ev of events) {
    if (ev.type === 'Act' && ev.act !== 'content' && ev.id) {
      contentMarkdown += `\n\n::${ev.act}{id="${ev.id}"}\n\n`
      const detail: ActivityDetail = { act: ev.act }
      if (ev.label) detail.label = ev.label
      activities[ev.id] = detail
    } else if (
      ev.type === 'ActDelta' &&
      ev.id &&
      typeof ev.text === 'string'
    ) {
      const existing = activities[ev.id]
      if (existing) {
        activities[ev.id] = { ...existing, text: (existing.text ?? '') + ev.text }
      } else {
        contentMarkdown += ev.text
      }
    } else if (ev.type === 'ActTool' && ev.id && activities[ev.id]) {
      activities[ev.id] = { ...activities[ev.id], toolArgs: ev.args }
    } else if (ev.type === 'ActResult' && ev.id && activities[ev.id]) {
      activities[ev.id] = { ...activities[ev.id], toolResult: ev.result }
    } else if (ev.type === 'ActEnd' && ev.id && activities[ev.id]) {
      activities[ev.id] = { ...activities[ev.id], status: ev.status, summary: ev.summary }
    }
  }

  return { contentMarkdown: contentMarkdown.trim(), activities }
}
