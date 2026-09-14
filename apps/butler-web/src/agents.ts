/**
 * 管家 Web 界面装配：新子 Agent 在这里加一行即可出现在界面与花名册里。
 */
import type { SubAgent } from '@meimaohouse/agent-sdk'
import chef from '@meimaohouse/chef-agent'
import cleaner from '@meimaohouse/cleaner-agent'
import { createHomeLightProvider, createLightAgent } from '@meimaohouse/light-agent'

/**
 * 灯光师接的是 home-light-sim 模拟器（真实 HTTP 调用，仓库内无假数据）。
 * 地址可用 LIGHT_SIM_BASE_URL 覆盖，缺省 http://127.0.0.3:9989。
 */
const light = createLightAgent({
  capabilities: { lights: createHomeLightProvider() },
})

export const agents: SubAgent[] = [chef, cleaner, light]
