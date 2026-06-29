export interface MasterOutlineLike {
  theme: string;
  mainLine: string;
  ending: string;
  powerProgression: { volume: number; level: string; note?: string }[];
  hiddenLines: {
    name: string;
    type?: string;
    plant?: string;
    advance?: string[];
    reveal?: string;
  }[];
  volumeSplitLogic: string;
  threeAct?: {
    act1Turn?: { atVolume: number; beat: string };
    act2Turn?: { atVolume: number; beat: string };
    act3Turn?: { atVolume: number; beat: string };
  };
}

/**
 * 拼【总纲】slice(全书北极星):故事核/主线/结局 + 力量进阶曲线 + 暗线时刻表 + 卷划分。
 * 全空 → ''(不注入)。纯函数,不带前导换行;调用方自行加间距。
 * main(ContextAssembler 首个 slice)+ writer(runTurn augment)共用。
 */
export function buildMasterOutlineSlice(
  m: MasterOutlineLike | null,
): string {
  if (!m) return '';
  const has =
    m.theme ||
    m.mainLine ||
    m.ending ||
    (m.powerProgression && m.powerProgression.length) ||
    (m.hiddenLines && m.hiddenLines.length) ||
    m.volumeSplitLogic ||
    (m.threeAct && Object.keys(m.threeAct).length);
  if (!has) return '';
  const lines: string[] = ['【总纲】'];
  if (m.theme) lines.push(`故事核:${m.theme}`);
  if (m.mainLine) lines.push(`主线:${m.mainLine}`);
  if (m.ending) lines.push(`结局:${m.ending}`);
  if (m.powerProgression?.length) {
    lines.push(
      '力量进阶:' +
        m.powerProgression
          .map((p) => `卷${p.volume}:${p.level}${p.note ? `(${p.note})` : ''}`)
          .join(' · '),
    );
  }
  if (m.hiddenLines?.length) {
    lines.push(
      '暗线(计划):' +
        m.hiddenLines
          .map(
            (h) =>
              `${h.name}:埋${h.plant ?? '?'}${h.advance?.length ? `→推${h.advance.join('·')}` : ''}→揭${h.reveal ?? '?'}`,
          )
          .join(' / '),
    );
  }
  if (m.volumeSplitLogic) lines.push(`卷划分:${m.volumeSplitLogic}`);
  const ta = m.threeAct;
  if (ta && Object.keys(ta).length) {
    const turns = [
      ta.act1Turn && `一幕末(卷${ta.act1Turn.atVolume}):${ta.act1Turn.beat}`,
      ta.act2Turn &&
        `二幕末·灵魂黑夜(卷${ta.act2Turn.atVolume}):${ta.act2Turn.beat}`,
      ta.act3Turn && `三幕末(卷${ta.act3Turn.atVolume}):${ta.act3Turn.beat}`,
    ].filter(Boolean);
    if (turns.length) lines.push('三幕:' + turns.join(' / '));
  }
  return lines.join('\n');
}
