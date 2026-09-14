import { CapabilityError, defineDomainTool, type DomainTool } from '@meimaohouse/agent-sdk'
import { z } from 'zod'
import type {
  LightAction,
  LightCapabilities,
  LightPayload,
  LightProvider,
  LightState,
  Rgb,
} from './capabilities.js'

const RgbSchema = z.object({
  r: z.number().int().min(0).max(255).describe('红色分量 0-255'),
  g: z.number().int().min(0).max(255).describe('绿色分量 0-255'),
  b: z.number().int().min(0).max(255).describe('蓝色分量 0-255'),
})

/** 单灯与批量控制共用的字段 */
const ControlFields = {
  on: z.boolean().optional().describe('开关；仅 action=set 时有效'),
  brightness: z.number().int().min(0).max(100).optional().describe('亮度 0-100 整数；0 等同关灯'),
  color: RgbSchema.optional().describe('RGB 颜色；与 colorTemp 二选一'),
  colorTemp: z.number().int().min(2700).max(6500).optional().describe('色温 2700-6500K；与 color 二选一'),
}

interface ControlInput {
  action: LightAction
  on?: boolean
  brightness?: number
  color?: Rgb
  colorTemp?: number
}

function checkNoColorConflict(value: { color?: Rgb; colorTemp?: number }): boolean {
  return value.color === undefined || value.colorTemp === undefined
}

function checkSetHasFields(value: ControlInput): boolean {
  if (value.action !== 'set') return true
  return (
    value.on !== undefined ||
    value.brightness !== undefined ||
    value.color !== undefined ||
    value.colorTemp !== undefined
  )
}

/** 把工具入参收敛成模拟器要的 payload；turnOn/turnOff 不带 payload */
function buildPayload(input: ControlInput): LightPayload | undefined {
  if (input.action !== 'set') return undefined
  const payload: LightPayload = {}
  if (input.on !== undefined) payload.on = input.on
  if (input.brightness !== undefined) payload.brightness = input.brightness
  if (input.color !== undefined) payload.color = input.color
  if (input.colorTemp !== undefined) payload.colorTemp = input.colorTemp
  return payload
}

/** 写操作后回读权威状态，确认“真的生效了” */
async function readLight(provider: LightProvider, lightId: string): Promise<LightState> {
  const all = await provider.list()
  const found = all.find((light) => light.lightId === lightId)
  if (!found) {
    throw new CapabilityError(
      `灯光服务里不存在 lightId=${lightId}，请先用 light_status 查询可用灯具`,
      'light_not_found',
    )
  }
  return found
}

function selectTargets(
  all: LightState[],
  input: { roomId?: string; lightIds?: string[] },
): LightState[] {
  if (input.lightIds) {
    const wanted = new Set(input.lightIds)
    return all.filter((light) => wanted.has(light.lightId))
  }
  const key = input.roomId
  return all.filter((light) => light.roomId === key || light.roomName === key)
}

/** 根据宿主实际注入的能力动态生成工具；没有 provider 时不暴露任何工具。 */
export function createLightTools(capabilities: LightCapabilities = {}): DomainTool[] {
  const provider = capabilities.lights
  if (!provider) return []

  return [
    defineDomainTool({
      name: 'light_status',
      description:
        '读取全屋灯具的真实状态（房间、名称、开关、亮度、颜色、色温）。可按房间或只看开着的灯过滤；不确定 lightId 时先调用它查询。',
      inputSchema: z.object({
        roomId: z
          .string()
          .optional()
          .describe('房间，可用 roomId 或房间名，如 living / 客厅 / kitchen / 厨房'),
        onlyOn: z.boolean().optional().describe('只返回当前开着的灯'),
      }),
      execute: async ({ roomId, onlyOn }) => {
        const all = await provider.list()
        const key = roomId?.trim()
        const lights = all
          .filter((light) => !key || light.roomId === key || light.roomName === key)
          .filter((light) => !onlyOn || light.on)
        return { total: all.length, count: lights.length, lights }
      },
    }),

    defineDomainTool({
      name: 'light_control',
      description:
        '控制单盏灯：开关、调亮度、调 RGB 颜色、调色温。执行后会回读真实状态，失败会如实返回错误。',
      inputSchema: z
        .object({
          lightId: z
            .string()
            .min(1)
            .describe('灯具 ID，如 living-light-0；不确定时先用 light_status 查询'),
          action: z
            .enum(['set', 'turnOn', 'turnOff'])
            .describe('set=按字段设置；turnOn=开灯并保留原亮度颜色；turnOff=关灯'),
          ...ControlFields,
        })
        .refine(checkNoColorConflict, { message: 'color 与 colorTemp 二选一，不能同时下发' })
        .refine(checkSetHasFields, {
          message: 'action=set 时至少要提供 on / brightness / color / colorTemp 之一',
        }),
      execute: async (input) => {
        await provider.send({
          lightId: input.lightId,
          action: input.action,
          payload: buildPayload(input),
        })
        return { lightId: input.lightId, state: await readLight(provider, input.lightId) }
      },
    }),

    defineDomainTool({
      name: 'light_group_control',
      description:
        '批量控制多盏灯：按房间或按 lightId 列表下发同一组指令。逐盏执行并汇报每盏的成功与失败，不做假成功。',
      inputSchema: z
        .object({
          roomId: z.string().optional().describe('按房间选择，可用 roomId 或房间名；与 lightIds 二选一'),
          lightIds: z
            .array(z.string().min(1))
            .min(1)
            .optional()
            .describe('按 lightId 列表精确选择；与 roomId 二选一'),
          action: z.enum(['set', 'turnOn', 'turnOff']).describe('要执行的动作'),
          ...ControlFields,
        })
        .refine((value) => (value.roomId !== undefined) !== (value.lightIds !== undefined), {
          message: 'roomId 与 lightIds 必须二选一（只填一个）',
        })
        .refine(checkNoColorConflict, { message: 'color 与 colorTemp 二选一，不能同时下发' })
        .refine(checkSetHasFields, {
          message: 'action=set 时至少要提供 on / brightness / color / colorTemp 之一',
        }),
      execute: async (input) => {
        const all = await provider.list()
        const targets = selectTargets(all, input)
        if (targets.length === 0) {
          throw new CapabilityError(
            `没有匹配的灯具（roomId=${input.roomId ?? '-'}，lightIds=${input.lightIds?.join(',') ?? '-'}）`,
            'light_not_found',
          )
        }

        const payload = buildPayload(input)
        const results: Array<{ lightId: string; ok: boolean; error?: string }> = []
        for (const target of targets) {
          try {
            await provider.send({ lightId: target.lightId, action: input.action, payload })
            results.push({ lightId: target.lightId, ok: true })
          } catch (err) {
            results.push({
              lightId: target.lightId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        const touched = new Set(results.map((item) => item.lightId))
        const after = await provider.list()
        return {
          requested: targets.length,
          succeeded: results.filter((item) => item.ok).length,
          failed: results.filter((item) => !item.ok).length,
          results,
          lights: after.filter((light) => touched.has(light.lightId)),
        }
      },
    }),
  ]
}
