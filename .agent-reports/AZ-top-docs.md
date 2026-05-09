# AZ — 顶层文档 (Batch 18 A)

重写 README.md:从 M1 setup 页换成产品级 landing(价值 / 特性 / 快速开始 / 文档索引 / 环境变量表)。新建 docs/architecture.md:Monorepo 布局、ws 数据流 ascii、host 模块职责表、~/.rcc 存储清单、外部依赖、扩展点。新建 docs/threat-model.md:Assets / Trust Boundaries 框图 / 13 条威胁×控制×残余风险表 / 已知局限(plugin 非沙箱、update sha256-only、audit 无远程备份、approval 启发式)/ 建议部署姿势。FEATURES.md 加 M10 section + 变更日志一行。未改 CHANGELOG,未 typecheck,未碰 plugin-authoring / starters / operations。
