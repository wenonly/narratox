import type { Activity } from '@/types/os'
import ActivityItem from './ActivityItem'

/**
 * 扁平活动时间线:把一条 agent 消息的 activities[] 渲染成竖直的、可展开的条目列表。
 * think(推理)/ tool(工具调用)/ stage(阶段分隔)各占一行;content 条目不在此渲染
 * (其增量已并入消息体 message.content,由 MarkdownRenderer 显示)。stage 作视觉分组,
 * 后续 think/tool 是平级条目,只是时序跟在 stage 后。
 */
const ActivityTimeline = ({ activities }: { activities?: Activity[] }) => {
  if (!activities || activities.length === 0) return null
  const rows = activities.filter((a) => a.act !== 'content')
  if (rows.length === 0) return null
  return (
    <div className="mt-2 flex w-full flex-col gap-1">
      {rows.map((a) => (
        <ActivityItem key={a.id} activity={a} />
      ))}
    </div>
  )
}

export default ActivityTimeline
