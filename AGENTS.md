# SAG

- 大道至简，不维护旧格式，不为未来加壳。世界是业务合同，代码和留影不自动修改需求。
- 世界目录含 `world.yaml`、前台构建目录、`initial.sqlite`。根 `name` 是身份；只改原目录，不另存第二份配置。
- YAML 结构统一单数：`domain → node → packet / input / logic / route / output`，另有 `service / resource / fable`。格式以 `core/model.ts` 和示例为准。
- 引用写 `[名称:类型]`，`/` 分层，`.` 取字段。绝对坐标从 `domain` 开始，局部坐标相对当前小域。YAML 引用编码为单元素列表，多个引用再用列表装；不接受裸路径。
- 字段只有 `text / number / boolean / object`。`object` 携带 JSON 对象或数组，不声明或读取内部字段。只有 `optional: true` 能缺席；`default` 先填省略值，类型错误仍失败。
- `call / go / read / write` 用 `动词([坐标], 参数)`，坐标不加引号。`read` 和 IF 共用比较、`&&`、`||` 与括号。`call / go / write` 支持字段映射或已声明整包。调用结果类型可推导，显写须匹配。
- 路由用 `IF 条件 go([出口:output], 数据包)`，最后无条件 `go`。出口自带 `logic` 时，选中后才调用，再组装数据；不为条件调用拆技术小域。
- `output.packet` 声明合同。出口 `action` 中 `go([小域:node], output)` 单向交付、`return()` 原位回复，无去向则输出后结束。道路从小域间调用和交付派生。
- `service` 与 `domain` 同级。服务声明 `description / script / input / output`，用 `call([名称:service], 数据包)` 等待回复。Node.js 脚本以世界目录为工作目录，stdin 收 JSON，stdout 返回 JSON。前台媒体用地址。
- UI 大域用 `type: UI` 和 `view.directory`。表单 `sag-entry-input` 提交具名字段；`sag-output` 观察指定前台小域的输出，与交付去向无关。自定义页面用 `SAG.input`、`SAG.onOutput`。前台不写业务判断。
- `resource.field` 对应 SQLite 表列；`write([表:resource], 数据包)` 在交付前追加运行副本。寓言是 `[[全坐标], 业务要求]`，对照留影评审。
- 一次启动持续到停止，输入共享运行数据。留影在启动时选择，停止时封存配置、前台资产、数据和事件。回放使用封存的事件。
- 唯一示例 `examples/photo-recognition/` 供内置世界和说明书共用。前台只提交样片路径。正常分支两次调用语音样例服务，低分和安全分支直接回复。
- 说明书 `docs/manual.md`：图解优先、短句、术语可跳转。字段和事实不要藏在废话里。主体抽屉悬浮，不影响地图镜头。
- 修改后运行 `npm run check`、`npm test`、`npm run build` 和目录检查，交互用浏览器核验。只访问本地，不接 PRE/PROD，不使用真实用户数据。
