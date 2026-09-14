import {
  defineSubAgent,
  type Memory,
  type ModelInstance,
  type SubAgent,
} from '@meimaohouse/agent-sdk'
import type { LightCapabilities } from './capabilities.js'
import { createLightTools } from './tools.js'

export * from './capabilities.js'
export * from './home-light-provider.js'
export * from './tools.js'

export interface LightAgentOptions {
  capabilities?: LightCapabilities
  model?: ModelInstance
  memory?: Memory
}

/**
 * 创建灯光师 Agent 壳。
 *
 * 不传 capabilities 时不会注册任何灯光工具，模型只能明确报告能力未配置，
 * 不能伪造“已开灯 / 已调到 60%”这类结果。
 */
export function createLightAgent(options: LightAgentOptions = {}): SubAgent {
  const tools = createLightTools(options.capabilities)
  const configured = [options.capabilities?.lights ? '灯具控制' : ''].filter(Boolean)

  return defineSubAgent({
    id: 'light',
    name: '灯光师',
    domain: '灯光域',
    description:
      '掌管全屋灯光：查询各房间灯具的开关、亮度、颜色与色温，开关灯、调亮度、调色、调色温，并按房间或灯具列表批量控制。',
    systemPrompt: `你的工作范围：
- 查询全屋各房间灯具的真实状态（开关、亮度、RGB 颜色、色温）；
- 开关单盏灯、调节亮度（0-100）、调节颜色、调节色温（2700-6500K）；
- 按房间或指定灯具列表批量开关与调节。

当前可用能力：${configured.length > 0 ? configured.join('、') : '无'}。

行为准则：
- 只能依据 light_status / light_control / light_group_control 返回的真实数据作答，禁止编造灯具 ID、亮度、颜色，禁止谎报“已开灯/已关灯”；
- 不确定 lightId 时先调用 light_status 查询，禁止猜测或拼造 ID；
- 批量操作要先明确作用范围；主人没有明确要求却涉及全屋或跨房间改动时，返回 status=needs_human 先确认；
- 工具报错时如实说明失败原因和受影响的灯具，并给出可执行的下一步；
- 如果所需能力没有对应工具，返回 status=unavailable，并设置 error_code=capability_not_configured；
- 需要其他领域协作时写入 suggestions，由管家转派。`,
    tools,
    model: options.model,
    memory: options.memory,
  })
}

/** 默认导出空壳 Agent，供应用层注入真实灯光能力后装配。 */
export const light = createLightAgent()
export default light
