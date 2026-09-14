# 领域 Agent

当前可用的领域 Agent：

- `chef`：厨房域（空壳，能力待注入）
- `cleaner`：清洁域（空壳，能力待注入）
- `light`：灯光域（自带 home-light-sim HTTP 适配器，见 [light/README.md](light/README.md)）

领域能力通过 `capabilities` 接口由宿主注入。仓库不提供模拟成功数据；未配置能力时，
Agent 必须返回 `unavailable`。
