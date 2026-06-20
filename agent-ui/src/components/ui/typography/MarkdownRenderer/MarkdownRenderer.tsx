import { type FC } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

import { type MarkdownRendererProps } from './types'
import { inlineComponents } from './inlineStyles'
import { components } from './styles'
import {
  activityRemarkPlugins,
  activitySanitizeSchema,
  ThinkBlock,
  ToolBlock,
  StageBlock
} from './activities'

const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  children,
  classname,
  inline = false
}) => (
  <ReactMarkdown
    className={cn(
      'prose prose-h1:text-xl dark:prose-invert flex w-full flex-col gap-y-2 rounded-lg',
      classname
    )}
    components={
      {
        ...(inline ? inlineComponents : components),
        think: ThinkBlock,
        tool: ToolBlock,
        stage: StageBlock
      } as Components
    }
    remarkPlugins={[remarkGfm, ...activityRemarkPlugins]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, activitySanitizeSchema]]}
  >
    {children}
  </ReactMarkdown>
)

export default MarkdownRenderer
