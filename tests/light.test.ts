import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import { CapabilityError } from '@meimaohouse/agent-sdk'
import {
  createHomeLightProvider,
  createLightTools,
  light,
  type LightCommand,
  type LightProvider,
  type LightState,
} from '@meimaohouse/light-agent'

const sampleLights: LightState[] = [
  {
    lightId: 'living-light-0',
    roomId: 'living',
    roomName: '客厅',
    name: '主吸顶灯',
    on: true,
    brightness: 65,
    color: { r: 255, g: 230, b: 200 },
    colorTemp: 4000,
  },
  {
    lightId: 'kitchen-light-0',
    roomId: 'kitchen',
    roomName: '厨房',
    name: '集成吊顶主灯',
    on: false,
    brightness: 90,
    color: { r: 255, g: 240, b: 220 },
    colorTemp: 5500,
  },
]

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法获取测试端口')
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('default light shell exposes no fake tools', () => {
  assert.deepEqual(light.spec.tools, [])
})

test('light tools are created only when a provider is injected', () => {
  assert.deepEqual(createLightTools(), [])

  const provider: LightProvider = {
    list: async () => sampleLights,
    send: async () => undefined,
  }
  assert.equal(createLightTools({ lights: provider }).length, 3)
})

test('light_control sends the command and returns the fresh authoritative state', async () => {
  const sent: LightCommand[] = []
  let current = sampleLights[1]
  const provider: LightProvider = {
    list: async () => [current],
    send: async (command) => {
      sent.push(command)
      current = {
        ...current,
        on: command.payload?.on ?? current.on,
        brightness: command.payload?.brightness ?? current.brightness,
      }
    },
  }

  const tools = createLightTools({ lights: provider })
  const raw = await tools[1].invoke({ lightId: 'kitchen-light-0', action: 'set', on: true, brightness: 55 })
  const result = JSON.parse(String(raw))

  assert.equal(result.ok, true)
  assert.equal(result.data.state.brightness, 55)
  assert.equal(result.data.state.on, true)
  assert.deepEqual(sent, [
    { lightId: 'kitchen-light-0', action: 'set', payload: { on: true, brightness: 55 } },
  ])
})

test('light_group_control reports per-light failures without faking success', async () => {
  const provider: LightProvider = {
    list: async () => sampleLights,
    send: async (command) => {
      if (command.lightId === 'kitchen-light-0') throw new Error('设备离线')
    },
  }

  const tools = createLightTools({ lights: provider })
  const raw = await tools[2].invoke({ roomId: 'kitchen', action: 'turnOff' })
  const result = JSON.parse(String(raw))

  assert.equal(result.ok, true)
  assert.equal(result.data.requested, 1)
  assert.equal(result.data.failed, 1)
  assert.equal(result.data.results[0].ok, false)
  assert.match(result.data.results[0].error, /设备离线/)
})

test('light_group_control rejects ambiguous selectors', async () => {
  const provider: LightProvider = {
    list: async () => sampleLights,
    send: async () => undefined,
  }
  const tools = createLightTools({ lights: provider })

  await assert.rejects(
    () => tools[2].invoke({ roomId: 'kitchen', lightIds: ['kitchen-light-0'], action: 'turnOff' }),
  )
})

test('home-light provider speaks the simulator HTTP protocol', async () => {
  const received: unknown[] = []
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/light/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(sampleLights))
      return
    }
    if (req.method === 'POST' && req.url === '/api/light/cmd') {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, msg: '接口不存在' }))
  })

  const port = await listen(server)
  try {
    const provider = createHomeLightProvider({ baseUrl: `http://127.0.0.1:${port}` })
    const lights = await provider.list()
    assert.equal(lights.length, 2)
    assert.equal(lights[0].lightId, 'living-light-0')
    assert.equal(lights[0].roomName, '客厅')

    await provider.send({ lightId: 'kitchen-light-0', action: 'turnOn' })
    assert.deepEqual(received[0], { lightId: 'kitchen-light-0', action: 'turnOn' })

    await provider.send({ lightId: 'living-light-0', action: 'set', payload: { brightness: 40 } })
    assert.deepEqual(received[1], {
      lightId: 'living-light-0',
      action: 'set',
      payload: { brightness: 40 },
    })
  } finally {
    await close(server)
  }
})

test('home-light provider surfaces simulator rejection with a coded error', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, msg: 'lightId 不存在：nope' }))
  })

  const port = await listen(server)
  try {
    const provider = createHomeLightProvider({ baseUrl: `http://127.0.0.1:${port}` })
    await assert.rejects(
      () => provider.send({ lightId: 'nope', action: 'turnOn' }),
      (err: unknown) =>
        err instanceof CapabilityError &&
        err.code === 'light_command_rejected' &&
        /lightId 不存在/.test(err.message),
    )
  } finally {
    await close(server)
  }
})

test('home-light provider reports an unreachable simulator', async () => {
  const provider = createHomeLightProvider({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 1500 })
  await assert.rejects(
    () => provider.list(),
    (err: unknown) =>
      err instanceof CapabilityError && err.code === 'light_service_unreachable',
  )
})
