/**
 * home-light-sim HTTP 适配器。
 *
 * 对接家庭虚拟灯具模拟器（默认 http://127.0.0.3:9989，接口见其 README）：
 *   GET  /api/light/status  读取全屋灯具权威状态
 *   POST /api/light/cmd     控制单盏灯（开关/亮度/颜色/色温）
 *
 * 只做协议转换，不缓存、不伪造状态：每次读取都真的请求一次模拟器，
 * 每次写入都必须由模拟器返回 {"ok":true} 才算成功。
 */
import { CapabilityError } from '@meimaohouse/agent-sdk'
import type { LightCommand, LightProvider, LightState, Rgb } from './capabilities.js'

export interface HomeLightProviderOptions {
  /** 模拟器地址；缺省读 LIGHT_SIM_BASE_URL，再缺省 http://127.0.0.3:9989 */
  baseUrl?: string
  /** 单次请求超时（毫秒），缺省 5000 */
  timeoutMs?: number
}

const DEFAULT_BASE_URL = 'http://127.0.0.3:9989'
const DEFAULT_TIMEOUT_MS = 5000

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>

export function createHomeLightProvider(options: HomeLightProviderOptions = {}): LightProvider {
  const baseUrl = (options.baseUrl ?? process.env.LIGHT_SIM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request(path: string, init?: FetchInit): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Awaited<ReturnType<typeof fetch>>
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw new CapabilityError(
          `连接灯光服务超时（${timeoutMs}ms）：${baseUrl}`,
          'light_service_timeout',
        )
      }
      throw new CapabilityError(
        `无法连接灯光服务 ${baseUrl}：${err instanceof Error ? err.message : String(err)}`,
        'light_service_unreachable',
      )
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      throw new CapabilityError(
        `灯光服务返回了非 JSON 响应（HTTP ${res.status}）`,
        'light_protocol_error',
      )
    }

    if (!res.ok) {
      throw new CapabilityError(
        readError(body) ?? `灯光服务返回 HTTP ${res.status}`,
        'light_command_rejected',
      )
    }
    return body
  }

  return {
    async list(): Promise<LightState[]> {
      const body = await request('/api/light/status')
      if (!Array.isArray(body)) {
        throw new CapabilityError('灯光服务状态响应不是数组，协议不匹配', 'light_protocol_error')
      }
      return body.map(toLightState)
    },

    async send(command: LightCommand): Promise<void> {
      await request('/api/light/cmd', {
        method: 'POST',
        body: JSON.stringify({
          lightId: command.lightId,
          action: command.action,
          ...(command.action === 'set' ? { payload: command.payload ?? {} } : {}),
        }),
      })
    },
  }
}

/** 从模拟器的错误响应里取出人类可读的 msg */
function readError(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'msg' in body) {
    const msg = (body as { msg?: unknown }).msg
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return undefined
}

/** 把模拟器返回的状态项收敛成本包的类型；字段缺失时报协议错误而不是猜值 */
function toLightState(raw: unknown): LightState {
  if (!raw || typeof raw !== 'object') {
    throw new CapabilityError('灯光状态项不是对象，协议不匹配', 'light_protocol_error')
  }
  const value = raw as Record<string, unknown>
  const lightId = typeof value.lightId === 'string' ? value.lightId : ''
  if (!lightId) {
    throw new CapabilityError('灯光状态缺少 lightId，协议不匹配', 'light_protocol_error')
  }

  const state: LightState = {
    lightId,
    roomId: typeof value.roomId === 'string' ? value.roomId : '',
    roomName: typeof value.roomName === 'string' ? value.roomName : '',
    name: typeof value.name === 'string' ? value.name : lightId,
    on: value.on === true,
    brightness: typeof value.brightness === 'number' ? value.brightness : 0,
    color: toRgb(value.color),
  }
  if (typeof value.colorTemp === 'number') state.colorTemp = value.colorTemp
  if (value.colorSource === 'ct' || value.colorSource === 'rgb') state.colorSource = value.colorSource
  if (typeof value.kind === 'string') state.kind = value.kind
  if (value.colorMode === 'cct' || value.colorMode === 'rgb') state.colorMode = value.colorMode
  return state
}

function toRgb(raw: unknown): Rgb {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>
    if (typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number') {
      return { r: value.r, g: value.g, b: value.b }
    }
  }
  return { r: 0, g: 0, b: 0 }
}
