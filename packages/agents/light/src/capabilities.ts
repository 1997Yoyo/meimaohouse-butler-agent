/**
 * 灯光域能力接口。
 *
 * 这里只定义"宿主需要提供什么"，不含任何模拟实现。
 * 对接 home-light-sim 的具体 HTTP 实现见 ./home-light-provider.ts。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 一盏灯的真实状态（来自设备/服务，不接受本地伪造） */
export interface LightState {
  lightId: string
  roomId: string
  roomName: string
  name: string
  on: boolean
  brightness: number
  color: Rgb
  colorTemp?: number
  colorSource?: 'ct' | 'rgb'
  kind?: string
  colorMode?: 'cct' | 'rgb'
}

export type LightAction = 'set' | 'turnOn' | 'turnOff'

/** action=set 时可下发的字段；turnOn/turnOff 忽略这些字段 */
export interface LightPayload {
  on?: boolean
  brightness?: number
  color?: Rgb
  colorTemp?: number
}

export interface LightCommand {
  lightId: string
  action: LightAction
  payload?: LightPayload
}

export interface LightProvider {
  /** 读取全部灯具的权威状态 */
  list(): Promise<LightState[]>
  /** 下发一条控制指令；成功返回，失败抛错（不做乐观更新） */
  send(command: LightCommand): Promise<void>
}

export interface LightCapabilities {
  lights?: LightProvider
}
