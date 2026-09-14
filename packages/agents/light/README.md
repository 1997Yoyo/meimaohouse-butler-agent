# @meimaohouse/light-agent

灯光师 Agent（灯光域）：把「全屋灯具控制」封装成管家可调用的子 Agent。

默认导出 `light` 是空壳（不注册任何工具）。真实设备通过 `LightProvider` 注入，
仓库不内置假状态；本包同时自带 **home-light-sim 适配器**，可直接开箱联调。

## 技能清单（工具）

| 工具 | 作用 | 入参 |
| --- | --- | --- |
| `light_status` | 读取全屋灯具真实状态 | `roomId?`（roomId 或房间名，如 `living` / `客厅`）、`onlyOn?` |
| `light_control` | 控制单盏灯 | `lightId`、`action`、`on?`、`brightness?`、`color?`、`colorTemp?` |
| `light_group_control` | 按房间或 ID 列表批量控制 | `roomId?` / `lightIds?`（二选一）、`action`、同上控制字段 |

`action` 语义：

- `set`：按给定字段设置，至少要给一个控制字段；
- `turnOn`：开灯，保留现有亮度与颜色；
- `turnOff`：关灯，亮度与颜色作为记忆保留。

取值约束（与模拟器一致，工具层会先拦住明显错误）：

- `brightness`：0-100 整数，`0` 等同关灯；
- `color`：`{r,g,b}` 每个分量 0-255 整数；
- `colorTemp`：2700-6500 整数（K）；
- `color` 与 `colorTemp` 二选一，不能同时下发；
- `lightId` 必须真实存在，不确定时先调 `light_status`。

## 为什么不会假成功

- 没有注入 `LightProvider` 时**不注册任何工具**，模型只能返回 `unavailable`；
- 写操作不做乐观更新：先 `POST /api/light/cmd`，再回读 `GET /api/light/status`，
  返回的是设备侧的权威状态；
- 批量控制逐盏执行、逐盏汇报，部分失败也如实返回；
- 失败统一带机器可读错误码。

## 错误码

| code | 含义 |
| --- | --- |
| `light_service_unreachable` | 连不上模拟器/设备服务 |
| `light_service_timeout` | 请求超时 |
| `light_command_rejected` | 服务返回 400（如 lightId 不存在、参数越界） |
| `light_protocol_error` | 响应不是预期格式 |
| `light_not_found` | 在状态列表里找不到目标灯 |

## 接入 home-light-sim

模拟器默认监听 `127.0.0.3:9989`。先启动它：

```bash
cd ../home-light-sim
npm install
npm start
```

装配灯光师：

```ts
import { createHomeLightProvider, createLightAgent } from '@meimaohouse/light-agent'

const light = createLightAgent({
  capabilities: { lights: createHomeLightProvider() },
})
```

地址优先级：`createHomeLightProvider({ baseUrl })` > `LIGHT_SIM_BASE_URL` > `http://127.0.0.3:9989`。

模拟器若用 `LIGHT_HOST=127.0.0.1 npm start` 启动，这里同步设置：

```
LIGHT_SIM_BASE_URL=http://127.0.0.1:9989
```

## 换成真实灯具

实现 `LightProvider` 两个方法即可，Agent 与工具无需改动：

```ts
import type { LightProvider } from '@meimaohouse/light-agent'

const myProvider: LightProvider = {
  list: () => myGateway.readAll(),
  send: (command) => myGateway.apply(command),
}

const light = createLightAgent({ capabilities: { lights: myProvider } })
```

开发规范见 [docs/SUBAGENT-DEV-GUIDE.md](../../../docs/SUBAGENT-DEV-GUIDE.md)。
