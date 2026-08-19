/**
 * 模型工厂 —— 厂商可插拔，默认留空。
 *
 * 设计意图：
 * - 框架代码不绑定、也不静态加载任何厂商 SDK（用哪个厂商才 import 哪个，
 *   未选的厂商连依赖都不用装）；
 * - 通过环境变量或 configureModel() 显式配置；未配置时快速失败并提示；
 * - Agent/子 Agent 构造保持同步（懒加载）：入口先 await configureModel()，
 *   之后 new Butler() / defineSubAgent() 从 getModel() 取实例。
 *
 * 新增厂商 = 在 createModel 的 switch 里加一个 case（见各 SDK 模型类）。
 */
import type { Model } from '@strands-agents/sdk'

/** 框架使用的模型实例类型（扩展厂商时无需改动，均为 SDK Model 子类） */
export type ModelInstance = Model

export interface ModelEnv {
  /** 厂商名：bedrock | openai（缺省读环境变量 MODEL_PROVIDER） */
  provider?: string
  /** Bedrock 区域（缺省 AWS_REGION） */
  bedrockRegion?: string
  /** Bedrock 模型 ID（缺省 BEDROCK_MODEL_ID） */
  bedrockModelId?: string
  /** OpenAI API Key（缺省 OPENAI_API_KEY） */
  openaiApiKey?: string
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super(
      [
        '模型厂商未配置。',
        '',
        '入口处先 await configureModel()，或在 .env 中设置 MODEL_PROVIDER（支持: bedrock | openai），例如：',
        '  MODEL_PROVIDER=openai',
        '  OPENAI_API_KEY=sk-...',
        '',
        '或代码注入: setModel(任意模型实例) 用于测试。',
      ].join('\n'),
    )
    this.name = 'ModelNotConfiguredError'
  }
}

/** 按厂商创建模型实例（动态 import，只加载所选厂商） */
export async function createModel(env: ModelEnv = {}): Promise<ModelInstance> {
  const provider = (env.provider ?? process.env.MODEL_PROVIDER ?? '').trim().toLowerCase()

  switch (provider) {
    case 'bedrock':
      return loadBedrock(env)
    case 'openai':
      return loadOpenAI(env)
    case '':
      throw new ModelNotConfiguredError()
    default:
      throw new Error(
        `未知模型厂商: "${provider}"（当前支持: bedrock, openai；其他厂商请扩展 createModel）`,
      )
  }
}

async function loadBedrock(env: ModelEnv): Promise<ModelInstance> {
  const { BedrockModel } = await import('@strands-agents/sdk/models/bedrock')
  const region = env.bedrockRegion ?? process.env.AWS_REGION ?? 'us-east-1'
  const modelId =
    env.bedrockModelId ?? process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6'
  return new BedrockModel({ region, modelId, maxTokens: 4096, temperature: 0.7 })
}

async function loadOpenAI(env: ModelEnv): Promise<ModelInstance> {
  const apiKey = env.openaiApiKey ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OpenAI 厂商需要 OPENAI_API_KEY 环境变量（或 createModel({ openaiApiKey })）')
  }
  try {
    const { OpenAIModel } = await import('@strands-agents/sdk/models/openai')
    return new OpenAIModel({ apiKey, api: 'chat' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`加载 OpenAI 模型失败：${msg}（使用该厂商需先安装依赖: npm i openai）`)
  }
}

/* ---------------- 模块级模型实例（懒解析，保持构造同步） ---------------- */

let cachedModel: ModelInstance | undefined

/**
 * 显式配置模型（异步：动态加载厂商）。入口处调用一次：
 *   await configureModel()            // 读环境变量
 *   await configureModel({ provider: 'openai' })
 */
export async function configureModel(env: ModelEnv = {}): Promise<ModelInstance> {
  cachedModel = await createModel(env)
  return cachedModel
}

/** 取当前模型实例；未配置抛 ModelNotConfiguredError */
export function getModel(): ModelInstance {
  if (!cachedModel) throw new ModelNotConfiguredError()
  return cachedModel
}

/** 注入模型实例（测试 / 自定义模型用），返回同一实例 */
export function setModel(model: ModelInstance): ModelInstance {
  cachedModel = model
  return model
}
