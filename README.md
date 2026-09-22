# iriso-plugins-market

Iriso 的**静态插件市场**：没有服务端、没有页面，GitHub 仓库本身就是 API。

App 只需要三个 GET：

| 请求 | 用途 |
| --- | --- |
| `index.json` | 插件列表（每个插件的最新版本 + 脚本哈希/大小/相对路径） |
| `plugins/<id>/<version>/plugin.json` | 某个版本的完整包描述（元数据 + 沙箱运行时 + hosts 权限） |
| `plugins/<id>/<version>/script.js` | 沙箱脚本正文（装进 WebView 执行的那段） |

`index.json` 用 Ed25519 签名（`index.json.sig`），公钥固定在 `keys/market-public.pem`；每个包的脚本哈希由索引携带。App 的信任链是：**验签索引 → 校验下载文件的 sha256 → 才交给沙箱执行**。

## 目录

```
index.json                  # 生成物：客户端唯一入口（`bun run index` 产出）
index.json.sig              # 生成物：对 index.json 原始字节的 Ed25519 签名
schema/                     # 两个 JSON Schema（给编辑器/贡献者看的规则说明）
docs/sandbox-api.md         # 插件作者必须读的沙箱契约
docs/publishing.md          # 发布流程
keys/market-public.pem      # 签名公钥（App 内置同一份）
plugins/<id>/<version>/     # 不可变的版本包：plugin.json + script.js
scripts/                    # 校验 / 建索引 / 签名 / 检查已发布版本
```

## 常用命令

```bash
bun run keys:generate   # 首次：生成签名密钥对（私钥进 .secrets/，公钥提交）
bun run verify          # 校验所有包：元数据 + 沙箱合规 + 能力一致性
bun run index           # 重新生成 index.json 并签名
bun run index:check     # CI 用：索引是否与包一致 + 签名是否有效
```

## 规则

- **本仓库是插件的唯一源**：App 不内置任何插件，全部从这里下载、安装、更新。
- **版本不可变**：`<id>@<version>` 一旦提交就不能再改，要改就发新版本（CI 用 `check-published.mjs` 卡住）。
- **id 不可变**：`pluginId` 是收藏 / 历史 / 已安装记录里的主键，改名会让用户数据失联。`builtin.` 前缀保留给官方随包插件，第三方请用 `community.`。
- **`hosts` 是权限**：`ctx.fetch` 只允许访问这些域名，更新时新增域名需要用户二次确认。
- **单文件脚本**：不打包依赖，cheerio/slim 由宿主注入；单次调用 30 秒超时。
- **每个插件带图标与设置**：`icon.svg` 提供列表图标，`settings` 声明设置页字段，脚本用 `ctx.settings` 读取。

细节见 `docs/sandbox-api.md` 与 `docs/publishing.md`。
