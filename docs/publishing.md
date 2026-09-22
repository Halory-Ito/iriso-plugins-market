# 发布流程

## 1. 新建一个包

```
plugins/<id>/<version>/
├─ plugin.json      # 元数据 + 沙箱运行时 + hosts 权限 + 脚本哈希
└─ script.js        # 单文件沙箱脚本（见 docs/sandbox-api.md）
```

`<id>` 规则：小写反向域名（`community.example`）。**`builtin.` 前缀保留给官方随包插件，第三方请用 `community.`。**
`<version>` 是 semver，目录名必须与 `plugin.json` 的 `version` 完全一致。

## 2. 写 `plugin.json`

```json
{
  "id": "community.example",
  "name": "Example",
  "version": "1.0.0",
  "apiVersion": 1,
  "minAppVersion": "1.0.0",
  "description": "一句话说明",
  "author": "you",
  "homepage": "https://example.com/",
  "languages": ["en"],
  "capabilities": ["featured", "search", "album", "tag"],
  "runtime": {
    "type": "sandbox",
    "baseUrl": "https://example.com/",
    "hosts": ["example.com", "cdn.example.com"],
    "script": "script.js",
    "sha256": "<bun run index 会写入>"
  },
  "settings": [],
  "changelog": ["首个版本"]
}
```

字段规则见 `schema/plugin.schema.json`；`scripts/verify-plugin.mjs` 是构建时的权威校验器。

`sha256` 可以先留空，跑一次 `bun run index` 会自动写回正确值（它由脚本内容决定）。

## 3. 本地校验 + 建索引

```bash
bun run verify     # 元数据 + 沙箱合规 + 能力一致性
bun run index      # 写回 sha256、生成 index.json、签名
```

`bun run verify` 会真的把脚本跑一遍（注入假的 `window.iriso`），断言：

- 脚本能解析、只注册一次、注册的 id 与包 id 一致；
- `capabilities` 声明的能力都有对应端点（`featured→getDiscoveryList`、`search→searchAlbums`、`album→getAlbum+getAlbumImages`、`tag→getTags`）；
- 没有用到被禁的宿主全局（`fetch` / `require` / `eval` / `document` …）。

## 4. 提交

提交 `plugins/…` 以及重新生成的 `index.json` + `index.json.sig`。CI（`.github/workflows/build-index.yaml`）会：

1. `bun run verify`；
2. `bun run index:check`（索引是否与包一致、签名是否有效）；
3. 拒绝修改**已发布版本**（要改就发新版本）。

## 5. 发新版本

```bash
cp -r plugins/community.example/1.0.0 plugins/community.example/1.0.1
# 改 plugin.json 的 version / changelog，改 script.js
bun run verify && bun run index
```

索引里每个插件只列**最高版本**；旧版本目录保留在仓库里，方便 App 固定或回滚。

## 6. `hosts` 权限变更

`hosts` 是插件的网络权限。**新增域名属于权限扩张**：App 在更新时会向用户展示 diff 并二次确认，所以不要顺手把无关域名塞进去。

## 7. 行尾必须是 LF

脚本按**字节**哈希（`runtime.sha256` / `scriptSha256`），CRLF 会让哈希对不上、App 直接拒绝安装。仓库已用 `.gitattributes`（`* text=auto eol=lf`）固定；如果本地改过行尾，跑一次 `git add --renormalize .` 再 `bun run index`。

## 8. 签名密钥

```bash
bun run keys:generate   # 生成 .secrets/market-signing-key.pem + keys/market-public.pem
```

- 私钥 `.secrets/market-signing-key.pem` **绝不提交**（已在 `.gitignore`），App 只内置 `keys/market-public.pem`。
- 想改成 CI 签名：把私钥内容 base64 后放进仓库 Secret `MARKET_SIGNING_KEY`，`sign-index.mjs` 会优先读它。
- 轮换密钥时同时更新 App 内置公钥，并让 App 支持多 `keyId`（`index.json.sig` 里带 `keyId`）。

## 9. 官方插件（BoBoPic / 次元画册）怎么进来

它们仍在 iriso app 仓库里开发，用 app 仓库的导出脚本同步过来（保证**只有一份源**）：

```bash
# 在 iriso app 仓库执行
bun run export:plugins --out ../iriso-plugins-market
# 然后在 market 仓库
bun run verify && bun run index
```

导出脚本读取 app 里的 `SandboxPluginDescriptor`（manifest + baseUrl + hosts + script），生成 `plugin.json` / `script.js`，并记录 `source.commit` 便于追溯。
