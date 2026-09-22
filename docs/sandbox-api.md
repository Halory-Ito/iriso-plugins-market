# 沙箱 API（`apiVersion: 1`）

插件脚本运行在 App 内一个隐藏的 WebView 里（每个插件一个）。**网络走原生代理，解析用宿主注入的 cheerio/slim**，脚本本身不打包任何依赖。

## 1. 脚本形态

- 单文件 IIFE：`(function () { ... })();`
- 只用 WebView 原生支持的语法（ES2017 以内即可，无需转译）
- 不允许 `require()` / `import()` / `eval()` / `new Function()` / `XMLHttpRequest` / `localStorage` / `document.*`（CI 会拒绝）
- 体积上限 **256 KB**；单次调用 **30 秒超时**
- 图片 URL **不需要**进白名单：App 用原生 `Image` 直连加载，脚本只负责返回 URL 字符串

## 2. 注册

```js
(function () {
  var BASE = 'https://example.com';

  window.iriso.registerSource({
    // 必须与 plugin.json 的 id 完全一致
    id: 'community.example',

    getDiscoveryList: async function (params, ctx) {
      var $ = await ctx.$(await loadPage(ctx, '/latest'));
      return { items: [], page: 1, pageSize: 0, hasMore: false };
    },
  });
})();
```

`registerSource` 必须**恰好调用一次**；注册的方法集合必须与 `plugin.json` 的 `capabilities` 一致（`bun run verify` 会断言）。

## 3. `ctx`

| 成员 | 说明 |
| --- | --- |
| `ctx.fetch(url)` | 原生代理请求，返回 `{ status, text }`。**host 必须在 `runtime.hosts` 白名单**，否则抛 `Host not allowed: <host>` |
| `ctx.$(html)` | 用宿主注入的 cheerio/slim 解析 HTML（等价 `ctx.cheerio.load(html)`） |
| `ctx.cheerio` | cheerio 模块本体 |
| `ctx.log(...)` | 预留，当前是 no-op |

`runtime.baseUrl` 只是沙箱文档的 origin，**不参与**白名单判定；要抓哪个域就把它写进 `runtime.hosts`。

## 4. 端点契约

| 方法 | capability | `params` | 返回 |
| --- | --- | --- | --- |
| `getDiscoveryList` | `featured` | `{ kind: 'latest' \| 'hot' \| 'recommended', page?, pageSize? }` | `AlbumPage` |
| `searchAlbums` | `search` | `{ keyword, page?, pageSize? }` | `AlbumPage` |
| `getAlbum` | `album` | `{ albumId }` | `AlbumItem \| null` |
| `getAlbumImages` | `album` | `{ albumId, page?, pageSize? }` | `ImagePage` |
| `getTags` | `tag` | `{}` | `string[]` |
| `getImage` | — | `{ imageId }` | `ImageItem \| null` |
| `getImageOriginal` | — | `{ imageId }` | `string \| null`（没有更高清版本时返回 `null`） |
| `getImageDetail` | — | `{ imageId }` | `{ title?, description? } \| null` |

返回结构：

```ts
interface AlbumItem {
  id: string;
  pluginId: string;        // 必填
  title: string;
  coverUrl?: string;
  description?: string;
  imageCount: number;
  tags?: string[];
  author?: string;
  createdAt?: number;      // 毫秒时间戳
  aspectRatio?: number;    // 封面宽/高，瀑布流排版用
}

interface ImageItem {
  id: string;
  pluginId: string;        // 必填
  title: string;
  url: string;             // 默认展示的图（最高可用清晰度）
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  tags?: string[];
  author?: string;
  description?: string;
  albumId?: string | null;
  createdAt?: number;
}

interface AlbumPage { items: AlbumItem[]; page: number; pageSize: number; hasMore: boolean }
interface ImagePage { items: ImageItem[]; page: number; pageSize: number; hasMore: boolean }
```

## 5. 硬性规则

1. **每个 item 必须带 `pluginId`**：聚合层靠它盖章来源、生成 React key、定位插件。
2. **id 是插件私有的，必须校验归属**：`getImage*` 收到不认识的 id 时返回 `null`。否则其它插件可能拿你的 id 去自己的站点解析，返回一张不属于你的图（线上真实事故：`149712797_p0` 被另一个插件解析成外站原图，直接 401 白屏）。
3. **不要在一次调用里串行抓取几十个页面**：30 秒上限 + 对目标站点的基本礼貌。
4. **失败就 `throw`**：宿主会捕获并让本次调用失败；不要静默返回半成品数据。
5. **id 生成规则要可逆**：`getImage` / `getImageOriginal` / `getImageDetail` 都要能从 `imageId` 反推出自己需要抓的页面（例如 `<作品id>_p<页码>`）。
6. 语言、站点限制尽量写在 `plugin.json` 的 `languages` / `description` 里，方便用户判断。

## 6. 兼容性

`apiVersion` 表示沙箱契约版本。宿主只安装 `apiVersion <= 自己支持版本` 的插件，并在 `minAppVersion` 不满足时拒绝安装。
