import type { ActivityFrame } from './assertTrajectory';

/**
 * L2/L3 用:HTTP POST /agents/:id/runs → 读完整 newline-JSON 流 → ActivityFrame[]。
 * 朴素实现:resp.text() 等流结束再 split(适合 turn 级,非增量)。
 */
export async function runTurn(
  base: string,
  token: string,
  novelId: string,
  sessionId: string,
  message: string,
  timeoutMs = 600_000,
): Promise<ActivityFrame[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/agents/${novelId}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, session_id: sessionId, stream: 'true' }),
      signal: controller.signal,
    });
    const text = await resp.text();
    const frames: ActivityFrame[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        frames.push(JSON.parse(trimmed));
      } catch {
        // 跳过非 JSON 行
      }
    }
    return frames;
  } finally {
    clearTimeout(timer);
  }
}
