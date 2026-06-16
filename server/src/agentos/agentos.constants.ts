export const AGENT_ID = 'deep-agent';
export const AGENT_NAME = 'Deep Agent';
export const AGENT_DB_ID = 'default';

export const SYSTEM_PROMPT =
  'You are a helpful, concise assistant. Reply in the same language as the user.';

// GLM Coding Plan（Z.ai）专用：必须用 coding 端点，普通 paas 端点会返回 1113（无资源包）。
// 模型为 GLM-5.2（reasoning 模型）。OpenAI 兼容协议，由 ChatOpenAI 接入。
export const GLM_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
export const GLM_MODEL = 'GLM-5.2';
