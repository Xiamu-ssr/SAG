# 世界说明书

一个目录，一个可运行的业务世界。

| 术语 | 源码 | 含义 |
| --- | --- | --- |
| 大域 | domain | 职责边界，自动连成道路 |
| 小域 | node | 输入、共享逻辑、IF、分支 |
| 数据包 | packet | 数据结构 |
| 数据资源 | resource | 持久状态 |
| 外部服务 | service | 可调用的脚本 |
| 寓言 | fable | 业务要求 |
| 留影 | recording | 从启动到停止的记录 |

## 01 · 添加世界

```text
我的世界/
├── world.yaml
├── frontend/index.html
├── services/speech.mjs  （使用外部服务时）
├── docs/                （可选）
└── initial.sqlite
```

首页选择目录即可添加。打开时检查格式。名称就是身份，改名须同步引用。

自建世界放在 SAG 目录之外。顶部「文档」读取世界的 `docs/`，可浏览 Markdown 和纯文本。迁移材料和暂时难以写成规则的细节可以放在这里。

下面的 `world.yaml` 就是首页「示例·拍照识物」使用的文件。

```yaml
{{WORLD_YAML}}
```

## 02 · 数据包

包声明在小域的 `packet` 中，输入、输出和调用共同引用。

```yaml
packet:
  照片:
    照片: {type: text, default: samples/ginkgo.svg}
```

只有 `optional: true` 的字段可以缺席。声明 `default` 时，省略就先补默认值。输入、调用、输出和写入都校验字段；传错类型、传 `null` 或多传字段都会报错。

类型只有 `text`、`number`、`boolean`、`object`。`object` 可以携带 JSON 对象或数组，SAG 不声明或读取它内部的字段。

数据包用 12 个星座和 32 色区分。

```diagram
packet-palette
```

## 03 · 大域与道路

`domain` 划分职责，里面的 `node` 承担业务。特殊类型只有 `type: UI`，表示前台；普通大域省略 `type`。

```diagram
domain
```

跨域调用与交付自动形成道路，不写 `road` 配置。点击道路查看数据包历史。

大域的 `notes` 可写多行文字或列表，点开大域即可查看。

```yaml
notes:
  - 识别结果交给前台展示。
  - 正常识别时合成主体和讲解的语音。
```

## 04 · 小域

```diagram
node
```

`input` 引用数据包，`node.logic` 是共享逻辑区，`route` 选分支，`output` 声明分支的数据包与交付动作。

点开小域的「数据包声明」查看它声明的结构。输入、输出和调用结果用坐标标记所引用的包。

```yaml
logic:
  - 结果:[识物结果:packet] = call([ant服务器:domain/识别:node], input)
route:
  - go([展示:output], 结果.数据)
output:
  展示:
    packet: [识物结果:packet]
    action:
      - go([ant服务器:domain/登记交付:node], output)
```

IF 按顺序匹配，最后用无条件的 `go` 兜底。比较支持 `==`、`!=`、`<`、`<=`、`>`、`>=`。用 `&&` 表示同时满足，用 `||` 表示至少满足一项。先算 `&&`，可用括号分组。

工作台按 IF 的比较规则和出口名生成路由说明。点「查看 YAML」可核对语句。「最近一次执行」显示截至时间线当前位置的调用、读取和回复。

```yaml
- >-
  IF 识别结果.数据.敏感 == true go([安全:output], {状态: "安全拦截", 提示: "这个东西可能有危险，请不要靠近"})
```

选中分支后，先执行它的私有逻辑 `output.<分支>.logic`，再组包并交付。识物示例在正常分支调用两次语音样例服务。

## 05 · 坐标

`[]` 表示引用，`:` 标类型，`/` 分层，`.` 取字段。

| 写法 | 指向 |
| --- | --- |
| `[前台:domain]` | 大域 |
| `[前台:domain/拍照识物:node]` | 小域 |
| `[前台:domain/拍照识物:node/照片:packet]` | 数据包 |
| `[照片:packet]` | 当前小域的包 |
| `[展示:output]` | 当前小域的出口 |
| `[识别记录:resource]` | 世界里的数据表 |
| `[语音样例:service]` | 世界里的外部服务 |
| `input.照片` | 输入字段 |
| `结果.数据.主体` | 调用返回字段 |

大域内可以用 `[登记交付:node]` 引用同域小域。跨域用全坐标。

## 06 · 关键字

| 关键字 | 动作 |
| --- | --- |
| `call([小域:node], 数据包)` | 传包并等待回复。 |
| `call([名称:service], 数据包)` | 调用脚本并等待它返回数据包。 |
| `go([出口:output], 数据包)` | 在路由里选出口并提供数据。 |
| `go([小域:node], output)` | 在出口把包交给指定小域，原小域不等待。 |
| `return()` | 把当前包还给调用方，从原来的 `call` 继续。 |
| `read([表:resource], 条件)` | 按条件查找一条运行记录，在逻辑区执行。 |
| `write([表:resource], 数据包)` | 追加运行记录，在交付前执行。 |

坐标直接写 `[]`。数据可以用 `{字段: 值}` 组包，也可以传 `input` 或 `结果.数据` 整包。冒号后和逗号两侧都可以留空格。文字值里的空格写在引号内，如 `"你好 "`。

`-` 标出一条列表项。语句含 `: ` 时，用 YAML 的 `>-` 或给整条语句加引号，把它读成一条文本。语句里的 `{}` 由 SAG 读取。

出口用 `go` 交给指定小域，或用 `return` 回复调用方。没有去向就输出后结束。`结果.分支` 是返回出口，`结果.数据` 是返回包。

## 07 · 前台

SAG 在 `type: UI` 大域里打开 `view.directory/index.html`，并注入前台桥。框架不限，资源用相对路径。

表单可直接用 HTML 属性：

```html
<form sag-entry-input="[前台:domain/拍照识物:node]">
  <input type="hidden" name="照片" value="samples/ginkgo.svg">
  <button type="submit">拍摄识物</button>
</form>
<div sag-output="[前台:domain/拍照识物:node]"></div>
```

- `sag-entry-input` 绑在表单上。提交时，控件的 `name` 对应数据包字段，`value` 提供值。数字控件传数字，复选框传布尔值。SAG 校验后把包交给该小域。
- `sag-output` 绑的是要看的前台小域。运行或回放走到该小域的输出时，容器显示最新数据包。

示例前台只提交样片路径。云服务大域按本地样片规则返回识别结果。「拍照识物」输出「展示」后，页面显示这份包，同时 `go` 把它交给「登记交付」。

自定义前台用 `SAG.input(小域坐标, 数据包)` 提交输入。接收成功时返回 `{runId}`。用 `SAG.onOutput(snapshot)` 订阅运行或回放中的输出。

图片、音频、视频和可直接播放的 HTTP 流都可以用 `text` 字段交付地址。示例用 `SAG.onOutput` 把两段语音地址交给 `<audio controls>`。世界内的资源用前台目录的相对路径。外部媒体的来源在 UI 大域的 `view.media` 里列出，例如 `["https://media.example.com"]`。该列表用于浏览器加载图片和音视频。

## 08 · 外部服务

`service` 与 `domain` 同级。用 `call` 调用，工作台在顶部「外部服务」展示输入、输出和脚本。

```yaml
service:
  语音样例:
    description: 按文本查找本地语音。
    script: services/speech.mjs
    input:
      文本: text
    output:
      音频地址: {type: text, optional: true}
```

脚本路径相对世界目录，惯例放在 `services/`。SAG 以该目录为工作目录启动 Node.js 子进程。脚本从 stdin 读一个 JSON 对象，向 stdout 写一个 JSON 对象。SAG 校验输入输出，等待最多 60 秒。服务成功时，`结果.分支` 为「完成」，`结果.数据` 为输出包。

```yaml
logic:
  - 语音 = call([语音样例:service], {文本:input.文本})
```

脚本以本机用户权限运行，可以调用 LLM 或 TTS。浏览器播放实时语音时，业务服务可提供能直接播放的 HTTP 音频地址。鉴权、服务协议和音频编码由业务代码处理。

## 09 · 数据资源

`resource` 定义表，`field` 定义列。启动时从 `initial.sqlite` 加载数据，多次输入共享内存副本。引擎直接执行 `read` 的条件匹配，`write` 向副本追加。保存留影时将结果写入留影的 SQLite。

```yaml
resource:
  识别记录:
    field:
      状态: text
      主体: {type: text, optional: true}
```

```yaml
logic:
  - 上次 = read([识别记录:resource], 状态 == input.状态 && 主体 == input.主体)
route:
  - IF 上次.分支 == "找到" go([再次登记:output], input)
  - go([完成:output], input)
```

`read` 和 IF 共用比较和组合条件。左边写表字段，右边写字面量或小域字段，例如 `状态 == input.状态 && 主体 != "未知"`。字段缺值时，该比较不命中。取最后一条匹配记录，用 `结果.分支` 区分「找到」和「未找到」，找到的记录在 `结果.数据`。

```yaml
action:
  - 'write([识别记录:resource], {状态: output.状态, 主体: output.主体})'
```

读取的包从顶部「数据」落到小域，写入的包从小域飞到「数据」并追加记录。

没有初始库时运行 `npm run world -- init-data /世界目录`。数据页可切换初始与当前状态。

## 10 · 寓言

每项是 `[全坐标, 业务要求]`，对照留影评审。

```yaml
fable:
  - [[ant服务器:domain/识别:node/正常:output], 正常识物必须交付主体。]
```

## 11 · 运行与留影

点击「启动」后世界持续运行，可随时暂停、继续或停止。每累计运行 10 分钟，工作台会询问是否暂停或停止。提醒期间照常运行。

启动时可勾选「空闲 30 分钟自动停止」和「保存留影」，默认都关闭。空闲从该世界的最后一次交互算起。勾选留影后，停止时封存本次运行的世界、前台、数据和事件。再次启动从初始库开始。

地图左上角第二个按钮展开或收起时间线。拖动时间线上沿调整高度，拖到底部即可收起。右上角可将运行或回放速度调到 0.1× 至 10×，默认 1×。回放使用封存的事件和前台资源。示例的语音为预先合成的本地 MP3。

## 12 · SKILL

```markdown
{{SAG_SKILL}}
```
