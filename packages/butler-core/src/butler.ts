/**
 * Butler —— 大管家主类（人类唯一入口）。
 *
 * 职责：
 * - 持有子 Agent 注册表，启动时把每个子 Agent 包装成 tool()（Agent-as-Tool）；
 * - chat(message)：人类对话入口，管家模型自行决策调度哪些子 Agent；
 * - delegate(task)：程序化直派（跳过模型，按领域直接调用子 Agent，供测试/编排用）；
 * - listAgents()：当前花名册。
 *
 * 懒加载：new Butler() 不创建模型/Agent，首次 chat()/delegate() 时才解析
 * （getModel()）。入口先 await configureModel()。
 */
import { Agent } from '@strands-agents/sdk'
import {
  getModel,
  createTaskId,
  type ModelInstance,
  type SubAgent,
  type TaskEnvelope,
  type TaskRequest,
  type ResultEnvelope,
} from '@meimaohouse/agent-sdk'
import { buildButlerSystemPrompt, type RosterEntry } from './prompts.js'

export interface ButlerOptions {
  /** 初始子 Agent 列表 */
  subAgents?: SubAgent[]
  /** 自定义管家 system prompt（缺省用内置模板，内置模板会自动带花名册） */
  systemPrompt?: string
  /** 模型实例（缺省走 getModel()） */
  model?: ModelInstance
  /** 管家显示名 */
  name?: string
}

export class Butler {
  readonly name: string

  private subAgents = new Map<string, SubAgent>()
  private model?: ModelInstance
  private agent?: Agent
  private customPrompt?: string

  constructor(opts: ButlerOptions = {}) {
    this.name = opts.name ?? '大管家'
    this.model = opts.model
    this.customPrompt = opts.systemPrompt
    for (const sa of opts.subAgents ?? []) {
      this.register(sa)
    }
  }

  /** 注册（或热追加）一个子 Agent；重复 id 抛错 */
  register(subAgent: SubAgent): this {
    if (this.subAgents.has(subAgent.spec.id)) {
      throw new Error(`子 Agent 已注册: ${subAgent.spec.id}`)
    }
    this.subAgents.set(subAgent.spec.id, subAgent)
    this.agent = undefined // 花名册变化，下次调用时重建管家
    return this
  }

  /** 当前花名册（含 description，供调试/UI 展示） */
  listAgents(): RosterEntry[] {
    return [...this.subAgents.values()].map((sa) => ({
      id: sa.spec.id,
      name: sa.spec.name,
      domain: sa.spec.domain,
      description: sa.spec.description,
    }))
  }

  /**
   * 人类对话入口：管家模型决策并调度子 Agent，返回转述结果。
   */
  async chat(message: string): Promise<string> {
    const agent = this.ensureAgent()
    const result = await agent.invoke(message)
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  /**
   * 程序化直派：跳过模型决策，按 domain 直接调用子 Agent。
   * 供测试、定时任务、外部编排使用；返回原始 ResultEnvelope。
   */
  async delegate(request: TaskRequest & { domain: string }): Promise<ResultEnvelope> {
    const sa = this.subAgents.get(request.domain)
    if (!sa) {
      throw new Error(
        `没有注册 domain 为 "${request.domain}" 的子 Agent。已注册: ${[...this.subAgents.keys()].join(', ') || '无'}`,
      )
    }
    const task: TaskEnvelope = {
      ...request,
      task_id: createTaskId(sa.spec.id),
      domain: sa.spec.id,
    }
    return sa.handleTask(task)
  }

  /** 懒创建管家 Agent（首次调用时解析模型） */
  private ensureAgent(): Agent {
    if (!this.agent) {
      this.agent = new Agent({
        systemPrompt: this.customPrompt ?? buildButlerSystemPrompt(this.listAgents()),
        tools: [...this.subAgents.values()].map((sa) => sa.toButlerTool()),
        model: this.model ?? getModel(),
      })
    }
    return this.agent
  }
}
