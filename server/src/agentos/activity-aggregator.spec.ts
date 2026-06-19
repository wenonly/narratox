import { aggregateActivities } from './activity-aggregator';
import type { ActivityEvent } from './activity.types';

describe('aggregateActivities', () => {
  it('builds markdown with markers + activities lookup in temporal order', () => {
    const events: ActivityEvent[] = [
      { type: 'Act', id: 'think-1', act: 'think', label: '思考' },
      { type: 'ActDelta', id: 'think-1', text: '想' },
      { type: 'ActDelta', id: 'content-1', text: '你好' },
      { type: 'Act', id: 'tool-1', act: 'tool', label: 'append_section' },
      { type: 'ActTool', id: 'tool-1', args: { chapterOrder: 1 } },
      { type: 'ActResult', id: 'tool-1', result: { ok: true } },
      { type: 'ActEnd', id: 'tool-1', status: 'ok' },
      { type: 'ActEnd', id: 'think-1', status: 'ok' },
    ];
    const { contentMarkdown, activities } = aggregateActivities(events);

    expect(contentMarkdown).toBe(
      '::think{id="think-1"}\n\n你好\n\n::tool{id="tool-1"}',
    );
    expect(activities['think-1']).toEqual({
      act: 'think',
      label: '思考',
      text: '想',
      status: 'ok',
    });
    expect(activities['tool-1']).toEqual({
      act: 'tool',
      label: 'append_section',
      toolArgs: { chapterOrder: 1 },
      toolResult: { ok: true },
      status: 'ok',
    });
    expect(activities['content-1']).toBeUndefined();
  });

  it('handles stage markers', () => {
    const events: ActivityEvent[] = [
      { type: 'Act', id: 'stage-1', act: 'stage', label: 'writer' },
      { type: 'ActDelta', id: 'content-1', text: '正文' },
    ];
    const { contentMarkdown, activities } = aggregateActivities(events);
    expect(contentMarkdown).toBe('::stage{id="stage-1"}\n\n正文');
    expect(activities['stage-1']).toEqual({ act: 'stage', label: 'writer' });
  });

  it('produces empty content for an event-less turn', () => {
    const { contentMarkdown, activities } = aggregateActivities([]);
    expect(contentMarkdown).toBe('');
    expect(activities).toEqual({});
  });
});
