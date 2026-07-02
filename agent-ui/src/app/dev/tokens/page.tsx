import { ActivityRow } from '@/components/ui/activity-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CollapsibleCard } from '@/components/ui/collapsible-card'

const BG_TOKENS: Array<{ name: string; cls: string }> = [
  { name: 'bg.base', cls: 'bg-bg-base' },
  { name: 'bg.darkest', cls: 'bg-bg-darkest' },
  { name: 'bg.dark', cls: 'bg-bg-dark' },
  { name: 'bg.card', cls: 'bg-bg-card' },
  { name: 'bg.cardElevated', cls: 'bg-bg-cardElevated' },
  { name: 'bg.raised', cls: 'bg-bg-raised' }
]

const ACCENT_TOKENS: Array<{ name: string; cls: string }> = [
  { name: 'accent.primary', cls: 'bg-accent-primary' },
  { name: 'accent.primarySoft', cls: 'bg-accent-primarySoft' },
  { name: 'accent.indigoLight', cls: 'bg-accent-indigoLight' },
  { name: 'accent.violet', cls: 'bg-accent-violet' },
  { name: 'accent.violetLight', cls: 'bg-accent-violetLight' }
]

const TEXT_TOKENS: Array<{ name: string; cls: string }> = [
  { name: 'text.primary', cls: 'text-text-primary' },
  { name: 'text.body', cls: 'text-text-body' },
  { name: 'text.secondary', cls: 'text-text-secondary' },
  { name: 'text.tertiary', cls: 'text-text-tertiary' },
  { name: 'text.label', cls: 'text-text-label' },
  { name: 'text.accent', cls: 'text-text-accent' }
]

function Swatch({ name, cls }: { name: string; cls: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`${cls} h-8 w-8 rounded-md border border-overlay-15`} />
      <span className="text-[11px] text-text-tertiary">{name}</span>
    </div>
  )
}

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-bg-base p-8 font-sans text-text-primary">
      <h1 className="mb-1 text-2xl font-bold">
        <span className="text-gradient-brand">Wave 0</span> Token &amp;
        Primitive Showcase
      </h1>
      <p className="mb-8 text-[12px] text-text-label">
        Temporary dev page — deleted in Wave 3.
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Background tokens
        </h2>
        <div className="flex flex-wrap gap-4">
          {BG_TOKENS.map((t) => (
            <Swatch key={t.name} {...t} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Accent tokens
        </h2>
        <div className="flex flex-wrap gap-4">
          {ACCENT_TOKENS.map((t) => (
            <Swatch key={t.name} {...t} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Text tokens
        </h2>
        <div className="flex flex-wrap gap-4">
          {TEXT_TOKENS.map((t) => (
            <span key={t.name} className={`${t.cls} text-[12px]`}>
              {t.name}
            </span>
          ))}
        </div>
      </section>

      <section className="mb-8 grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Card primitive</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[12px] text-text-body">
              Body text inside a Card. Token Spec §3.3.
            </p>
          </CardContent>
        </Card>
        <div className="glass-panel rounded-lg p-4">
          <p className="text-[12px] text-text-body">
            Glass panel utility (.glass-panel) — blur 20 + shadow 24.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Badges
        </h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="accent">accent</Badge>
          <Badge variant="neutral">neutral</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="destructive">destructive</Badge>
        </div>
      </section>

      <section className="mb-8 flex flex-col gap-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-label">
          Activity rows
        </h2>
        <ActivityRow variant="think">
          Considering the chapter outline and whether the hook lands.
        </ActivityRow>
        <ActivityRow variant="tool">get_outline()</ActivityRow>
        <ActivityRow variant="stage">chapter orchestrator</ActivityRow>
        <ActivityRow variant="content">
          第 3 章正文内容,由 writer agent 流式输出……
        </ActivityRow>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-label">
          Collapsible card
        </h2>
        <CollapsibleCard
          title="主角 · 林无忌"
          extra={<Badge variant="accent">PROTAGONIST</Badge>}
        >
          外貌 / 性格 / 动机 等 9 字段档案,展开后渲染。
        </CollapsibleCard>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-label">
          Buttons
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="default">default</Button>
          <Button variant="gradient">gradient</Button>
          <Button variant="soft">soft</Button>
          <Button variant="outline">outline</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="link">link</Button>
          <Button variant="destructive">destructive</Button>
          <Button variant="gradient" className="rounded-pill">
            gradient pill
          </Button>
        </div>
      </section>
    </main>
  )
}
