import type { ModelConfigRecord } from './model-factory';

/**
 * Model + Vendor 行 → ModelConfigRecord(运行时拼装,替代旧的 ModelConfig 直读)。
 * provider/baseUrl/apiKey 来自 Vendor(凭证级),model/temperature/id 来自 Model。
 * 纯函数,可单测;getModel 按 ${id}:${updatedAt}:${maxTokens}:${temperature} 缓存,
 * 原地编辑 Vendor/Model 会 bump updatedAt → cache miss(故 updatedAt 必须从 Model 行透传)。
 */
export function assembleModelConfig(
  model: { id: string; model: string; temperature: number | null; updatedAt: Date },
  vendor: { provider: string; baseUrl: string | null; apiKey: string },
): ModelConfigRecord {
  return {
    id: model.id,
    provider: vendor.provider,
    model: model.model,
    baseUrl: vendor.baseUrl,
    apiKey: vendor.apiKey,
    temperature: model.temperature,
    updatedAt: model.updatedAt,
  };
}
