import {
  type FC,
  type HTMLAttributes,
  type DetailedHTMLProps,
  type OlHTMLAttributes,
  type DelHTMLAttributes,
  type BlockquoteHTMLAttributes,
  type AnchorHTMLAttributes,
  type ImgHTMLAttributes
} from 'react'

/** ::think / ::tool / ::stage 内联指令的渲染组件签名(只接收 id 属性)。 */
export type ActivityComponent = FC<{ id?: string }>

interface MarkdownRendererProps {
  children?: string
  classname?: string

  inline?: boolean

  /**
   * 覆盖内联 `::tool` / `::think` / `::stage` 指令的渲染组件。
   * 传 `tool: () => null` 即可在外部用 ToolBatch 接管工具行的展示。
   */
  activityOverrides?: {
    think?: ActivityComponent
    tool?: ActivityComponent
    stage?: ActivityComponent
  }
}

type DefaultHTMLElement = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
>

type UnorderedListProps = DetailedHTMLProps<
  HTMLAttributes<HTMLUListElement>,
  HTMLUListElement
>
type OrderedListProps = DetailedHTMLProps<
  OlHTMLAttributes<HTMLOListElement>,
  HTMLOListElement
>

type EmphasizedTextProps = DefaultHTMLElement
type ItalicTextProps = DefaultHTMLElement

type StrongTextProps = DefaultHTMLElement
type BoldTextProps = DefaultHTMLElement

type UnderlinedTextProps = DefaultHTMLElement

type DeletedTextProps = DetailedHTMLProps<
  DelHTMLAttributes<HTMLModElement>,
  HTMLModElement
>

type HorizontalRuleProps = DetailedHTMLProps<
  HTMLAttributes<HTMLHRElement>,
  HTMLHRElement
>

type PreparedTextProps = DetailedHTMLProps<
  HTMLAttributes<HTMLPreElement>,
  HTMLPreElement
>

type BlockquoteProps = DetailedHTMLProps<
  BlockquoteHTMLAttributes<HTMLQuoteElement>,
  HTMLQuoteElement
>

type AnchorLinkProps = DetailedHTMLProps<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  HTMLAnchorElement
>

type HeadingProps = DetailedHTMLProps<
  HTMLAttributes<HTMLHeadingElement>,
  HTMLHeadingElement
>

type ImgProps = DetailedHTMLProps<
  ImgHTMLAttributes<HTMLImageElement>,
  HTMLImageElement
>

type ParagraphProps = DetailedHTMLProps<
  HTMLAttributes<HTMLParagraphElement>,
  HTMLParagraphElement
>

type TableProps = React.DetailedHTMLProps<
  React.TableHTMLAttributes<HTMLTableElement>,
  HTMLTableElement
>

type TableBodyProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLTableSectionElement>,
  HTMLTableSectionElement
>

type TableHeaderProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLTableSectionElement>,
  HTMLTableSectionElement
>

type TableHeaderCellProps = DetailedHTMLProps<
  HTMLAttributes<HTMLTableHeaderCellElement>,
  HTMLTableHeaderCellElement
>

type TableRowProps = DetailedHTMLProps<
  HTMLAttributes<HTMLTableRowElement>,
  HTMLTableRowElement
>

type TableCellProps = DetailedHTMLProps<
  HTMLAttributes<HTMLTableCellElement>,
  HTMLTableCellElement
>

export type {
  MarkdownRendererProps,
  UnorderedListProps,
  OrderedListProps,
  EmphasizedTextProps,
  ItalicTextProps,
  StrongTextProps,
  BoldTextProps,
  UnderlinedTextProps,
  DeletedTextProps,
  HorizontalRuleProps,
  PreparedTextProps,
  BlockquoteProps,
  AnchorLinkProps,
  HeadingProps,
  ImgProps,
  ParagraphProps,
  TableProps,
  TableHeaderProps,
  TableHeaderCellProps,
  TableBodyProps,
  TableRowProps,
  TableCellProps
}
