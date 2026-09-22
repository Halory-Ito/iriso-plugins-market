(function () {
  var BASE = 'https://wallhaven.cc';
  var API = BASE + '/api/v1';
  var PLUGIN_ID = 'wallhaven';

  // \u5355\u56FE id \u7EDF\u4E00\u52A0\u524D\u7F00\uFF1Awallhaven \u7684 id \u662F 6 \u4F4D\u5C0F\u5199\u5B57\u6BCD\u6570\u5B57\uFF0C\u7EAF\u6570\u5B57\u65F6\uFF08\u7EA6\u5343\u5206\u4E4B\u4E00\uFF09
  // \u4F1A\u548C BoBoPic \u7684 pixiv PID \u649E\u8F66\uFF0C\u524D\u7F00\u8BA9\u5F52\u5C5E\u6821\u9A8C\u4E00\u76EE\u4E86\u7136\u3002
  var ID_PREFIX = 'wh-';

  // \u641C\u7D22\u7ED3\u679C\u53EA\u6709\u5206\u8FA8\u7387\u6CA1\u6709\u6807\u7B7E\uFF0C\u8FDB\u8BE6\u60C5\u63A5\u53E3\u8865\u5168\u524D\u82E5\u5E72\u6761\uFF08\u58C1\u7EB8\u6CA1\u6709\u6807\u9898\uFF0C\u6807\u7B7E\u5C31\u662F\u5B83\u7684\u6807\u9898\uFF09\u3002
  var DEFAULT_ENRICH_LIMIT = 12;
  var ENRICH_CONCURRENCY = 4;
  var TAGS_LIMIT = 60;
  // \u6C99\u7BB1 WebView \u5E38\u9A7B\uFF0C\u8BE6\u60C5\u7F13\u5B58\u53EA\u505A\u6027\u80FD\u4F18\u5316\uFF0C\u8D85\u8FC7\u4E0A\u9650\u5C31\u6574\u4F53\u4E22\u5F03\u3002
  var DETAIL_CACHE_LIMIT = 500;

  // \u767D\u540D\u5355\u5F0F\u679A\u4E3E\uFF1A\u975E\u6CD5\u8BBE\u7F6E\u503C\u4E0D\u900F\u4F20\u7ED9 API\u3002
  // \u5185\u5BB9\u5206\u7EA7\u7528\u5BBF\u4E3B\u6807\u51C6\u9879 contentRating\uFF0C\u8FD9\u91CC\u7FFB\u8BD1\u6210 wallhaven \u7684 purity \u4F4D\u63A9\u7801\u3002
  var PURITY_BY_RATING = { sfw: '100', suggestive: '110', mixed: '111', nsfw: '001' };
  var CATEGORY_VALUES = ['111', '100', '010', '001', '110', '101', '011'];
  var TOP_RANGE_VALUES = ['1d', '3d', '1w', '1M', '3M', '6M', '1y'];

  var detailCache = {};

  /** \u8BFB\u53D6\u8BBE\u7F6E\u91CC\u7684\u5B57\u7B26\u4E32\u503C\uFF0C\u7A7A\u503C\u56DE\u9000\u5230\u9ED8\u8BA4\u3002 */
  function stringSetting(ctx, key, fallback) {
    var value = ctx && ctx.settings ? ctx.settings[key] : undefined;
    if (value === undefined || value === null || value === '') return fallback;
    return String(value);
  }

  /** \u8BFB\u53D6\u8BBE\u7F6E\u91CC\u7684\u975E\u8D1F\u6570\u5B57\uFF0C\u7F3A\u5931\u6216\u975E\u6CD5\u65F6\u56DE\u9000\u5230\u9ED8\u8BA4\u3002 */
  function numberSetting(ctx, key, fallback) {
    var raw = ctx && ctx.settings ? ctx.settings[key] : undefined;
    if (raw === undefined || raw === null || raw === '') return fallback;
    var value = Number(raw);
    return isFinite(value) && value >= 0 ? value : fallback;
  }

  /** \u4ECE\u56FA\u5B9A\u5019\u9009\u96C6\u91CC\u53D6\u8BBE\u7F6E\u503C\u3002 */
  function enumSetting(ctx, key, allowed, fallback) {
    var value = stringSetting(ctx, key, fallback);
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function apiKey(ctx) {
    return stringSetting(ctx, 'apiKey', '').trim();
  }

  /**
   * \u5BBF\u4E3B\u6807\u51C6\u9879 contentRating\uFF08sfw / suggestive / mixed / nsfw\uFF09\u2192 purity \u4F4D\u63A9\u7801\uFF1B
   * \u65E7\u7248 App \u53EF\u80FD\u7ED9\u4E0D\u5230\u8FD9\u4E2A key\uFF0C\u56DE\u9000\u5230 sfw\u3002
   */
  function purity(ctx) {
    var rating = stringSetting(ctx, 'contentRating', 'sfw');
    return PURITY_BY_RATING[rating] || '100';
  }

  function categories(ctx) {
    return enumSetting(ctx, 'categories', CATEGORY_VALUES, '111');
  }

  function topRange(ctx) {
    return enumSetting(ctx, 'topRange', TOP_RANGE_VALUES, '1M');
  }

  function buildQuery(pairs) {
    var parts = [];
    for (var index = 0; index < pairs.length; index += 1) {
      var value = pairs[index][1];
      if (value === undefined || value === null || value === '') continue;
      parts.push(encodeURIComponent(pairs[index][0]) + '=' + encodeURIComponent(String(value)));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  /** \u7EDF\u4E00\u7684 API \u8BF7\u6C42\uFF1A\u62FC\u4E0A apikey\u3001\u68C0\u67E5\u72B6\u6001\u7801\u5E76\u89E3\u6790 JSON\u3002 */
  async function apiFetch(ctx, path, pairs) {
    var query = (pairs || []).slice();
    var key = apiKey(ctx);
    if (key) query.push(['apikey', key]);

    var url = API + path + buildQuery(query);
    var response = await ctx.fetch(url);
    if (!response || response.status >= 400) {
      throw new Error('HTTP ' + (response && response.status) + ' ' + url);
    }

    var payload = JSON.parse(response.text);
    if (!payload || !payload.data) throw new Error('unexpected payload: ' + url);
    return payload;
  }

  /** \u53CD\u89E3\u5355\u56FE / \u5957\u56FE id\uFF0C\u8BA4\u4E0D\u51FA\u6765\u5C31\u8FD4\u56DE null\uFF08\u7EDD\u4E0D\u62FF\u522B\u4EBA\u7684 id \u53BB\u89E3\u6790\uFF09\u3002 */
  function parseId(value) {
    var match = /^wh-([a-z0-9]+)$/.exec(value || '');
    return match ? match[1] : null;
  }

  function wallpaperId(id) {
    return ID_PREFIX + id;
  }

  function aspectOf(item) {
    var width = Number(item.dimension_x);
    var height = Number(item.dimension_y);
    return width > 0 && height > 0 ? width / height : undefined;
  }

  function tagNames(item) {
    var source = item && item.tags ? item.tags : [];
    var names = [];
    for (var index = 0; index < source.length; index += 1) {
      if (source[index] && source[index].name) names.push(source[index].name);
    }
    return names;
  }

  /** wallhaven \u7684 created_at \u662F UTC \u7684 `YYYY-MM-DD HH:mm:ss`\u3002 */
  function parseDate(value) {
    if (!value) return undefined;
    var timestamp = Date.parse(String(value).replace(' ', 'T') + 'Z');
    return isFinite(timestamp) ? timestamp : undefined;
  }

  function formatSize(bytes) {
    var size = Number(bytes);
    if (!isFinite(size) || size <= 0) return '';
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size = size / 1024;
      index += 1;
    }
    var rounded = index === 0 || size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
    return rounded + ' ' + units[index];
  }

  /** \u58C1\u7EB8\u6CA1\u6709\u6807\u9898\uFF0C\u7528\u300C\u5206\u8FA8\u7387 \u00B7 \u4F53\u79EF \u00B7 \u6D4F\u89C8\u91CF \u00B7 \u6536\u85CF\u6570\u300D\u62FC\u4E00\u6BB5\u53EF\u8BFB\u6458\u8981\u3002 */
  function summaryOf(item) {
    var parts = [];
    if (item.resolution) parts.push(item.resolution);
    var size = formatSize(item.file_size);
    if (size) parts.push(size);
    if (typeof item.views === 'number') parts.push(item.views + ' views');
    if (typeof item.favorites === 'number') parts.push(item.favorites + ' favorites');
    return parts.join(' \u00B7 ');
  }

  function thumbOf(item) {
    return item && item.thumbs && item.thumbs.large ? item.thumbs.large : undefined;
  }

  /**
   * \u4E00\u5F20\u58C1\u7EB8\u5C31\u662F\u300C\u4E00\u5957\u53EA\u6709\u4E00\u5F20\u56FE\u7684\u5957\u56FE\u300D\u2014\u2014wallhaven \u6CA1\u6709\u771F\u6B63\u7684\u5408\u96C6\u6982\u5FF5\uFF0C
   * \u4E0E\u5176\u7F16\u9020\u5206\u7EC4\uFF0C\u4E0D\u5982\u8BA9\u6BCF\u5F20\u58C1\u7EB8\u72EC\u7ACB\u6210\u5361\u7247\u3002
   */
  function toAlbum(item) {
    var tags = tagNames(item);
    if (!tags.length && item.category) tags = [item.category];

    return {
      id: wallpaperId(item.id),
      pluginId: PLUGIN_ID,
      title: item.resolution || item.id,
      coverUrl: thumbOf(item),
      description: summaryOf(item),
      imageCount: 1,
      tags: tags,
      author: item.uploader ? item.uploader.username : undefined,
      createdAt: parseDate(item.created_at),
      aspectRatio: aspectOf(item),
    };
  }

  function toImage(item) {
    var thumb = thumbOf(item);
    var url = thumb || item.path;

    return {
      id: wallpaperId(item.id),
      pluginId: PLUGIN_ID,
      title: item.resolution || item.id,
      // \u5217\u8868 / \u7F51\u683C\u7528 432px \u7684 large \u7F29\u7565\u56FE\uFF0C\u539F\u56FE\u4EA4\u7ED9 getImageOriginal \u61D2\u52A0\u8F7D\u3002
      url: url,
      thumbnailUrl: url,
      width: Number(item.dimension_x) || undefined,
      height: Number(item.dimension_y) || undefined,
      tags: tagNames(item),
      author: item.uploader ? item.uploader.username : undefined,
      description: summaryOf(item),
      albumId: wallpaperId(item.id),
      createdAt: parseDate(item.created_at),
    };
  }

  function pageInfo(meta, page) {
    var lastPage = Number(meta && meta.last_page);
    var current = Number((meta && meta.current_page) || page);
    return {
      page: page,
      hasMore: isFinite(lastPage) && lastPage > 0 && current < lastPage,
      total: Number(meta && meta.total) || undefined,
    };
  }

  /** \u8BE6\u60C5\u63A5\u53E3\uFF08\u542B\u6807\u7B7E / \u4E0A\u4F20\u8005 / \u539F\u56FE\u5730\u5740\uFF09\uFF0C\u6309 id \u7F13\u5B58\u907F\u514D\u91CD\u590D\u8BF7\u6C42\u3002 */
  async function detailOf(ctx, id) {
    if (detailCache[id]) return detailCache[id];

    var payload = await apiFetch(ctx, '/w/' + encodeURIComponent(id), []);
    if (Object.keys(detailCache).length >= DETAIL_CACHE_LIMIT) detailCache = {};
    detailCache[id] = payload.data;
    return detailCache[id];
  }

  /** \u5217\u8868\u5361\u7247\u53EA\u6709\u5206\u8FA8\u7387\uFF0C\u5E76\u53D1\u8FDB\u8BE6\u60C5\u8865\u5168\u6807\u7B7E\u4E0E\u4E0A\u4F20\u8005\uFF08\u53EA\u8865\u524D N \u6761\uFF09\u3002 */
  async function enrich(ctx, albums) {
    var limit = numberSetting(ctx, 'enrichLimit', DEFAULT_ENRICH_LIMIT);
    var max = Math.min(limit, albums.length);
    if (max <= 0) return albums;

    var output = albums.slice();
    var cursor = { value: 0 };

    async function worker() {
      while (cursor.value < max) {
        var index = cursor.value;
        cursor.value += 1;

        var id = parseId(output[index].id);
        if (!id) continue;

        try {
          var detail = await detailOf(ctx, id);
          var tags = tagNames(detail);
          if (tags.length) output[index].tags = tags;
          if (detail.uploader && detail.uploader.username) {
            output[index].author = detail.uploader.username;
          }
        } catch (error) {
          // \u8BE6\u60C5\u5931\u8D25\u65F6\u4FDD\u7559\u5217\u8868\u9875\u5DF2\u6709\u5B57\u6BB5
        }
      }
    }

    var workers = [];
    for (var i = 0; i < ENRICH_CONCURRENCY; i += 1) workers.push(worker());
    await Promise.all(workers);
    return output;
  }

  /** \u6700\u65B0 / \u6700\u70ED / \u63A8\u8350\uFF1A\u5206\u522B\u5BF9\u5E94\u4E0A\u4F20\u65F6\u95F4\u3001Top List \u699C\u5355\u3001\u6536\u85CF\u6570\u3002 */
  function discoveryPairs(ctx, kind, page) {
    var pairs = [
      ['page', page],
      ['purity', purity(ctx)],
      ['categories', categories(ctx)],
    ];

    if (kind === 'hot') {
      pairs.push(['sorting', 'toplist']);
      pairs.push(['topRange', topRange(ctx)]);
    } else if (kind === 'recommended') {
      pairs.push(['sorting', 'favorites']);
    } else {
      pairs.push(['sorting', 'date_added']);
    }

    pairs.push(['order', 'desc']);
    return pairs;
  }

  window.iriso.registerSource({
    id: PLUGIN_ID,

    /** \u6240\u6709\u63D2\u4EF6\u5171\u7528\u7684\u4E09\u4E2A\u5165\u53E3\uFF1A\u6700\u65B0 / \u6700\u70ED / \u63A8\u8350\uFF08\u652F\u6301\u7FFB\u9875\uFF09\u3002 */
    getDiscoveryList: async function (params, ctx) {
      var kind = (params && params.kind) || 'latest';
      var page = (params && params.page) || 1;

      var payload = await apiFetch(ctx, '/search', discoveryPairs(ctx, kind, page));
      var items = (payload.data || []).map(toAlbum);
      var info = pageInfo(payload.meta, page);

      return {
        items: items,
        page: page,
        pageSize: items.length,
        hasMore: info.hasMore,
        total: info.total,
      };
    },

    searchAlbums: async function (params, ctx) {
      var keyword = ((params && params.keyword) || '').trim();
      var page = (params && params.page) || 1;
      if (!keyword) return { items: [], page: page, pageSize: 0, hasMore: false };

      var payload = await apiFetch(ctx, '/search', [
        ['q', keyword],
        ['page', page],
        ['purity', purity(ctx)],
        ['categories', categories(ctx)],
        ['sorting', 'relevance'],
        ['order', 'desc'],
      ]);

      var albums = await enrich(ctx, (payload.data || []).map(toAlbum));
      var info = pageInfo(payload.meta, page);

      return {
        items: albums,
        page: page,
        pageSize: albums.length,
        hasMore: info.hasMore,
        total: info.total,
      };
    },

    getAlbum: async function (params, ctx) {
      var id = parseId((params && params.albumId) || '');
      if (!id) return null;

      var detail = await detailOf(ctx, id);
      return detail ? toAlbum(detail) : null;
    },

    getAlbumImages: async function (params, ctx) {
      var id = parseId((params && params.albumId) || '');
      if (!id) return { items: [], page: 1, pageSize: 0, hasMore: false };

      var detail = await detailOf(ctx, id);
      var images = detail ? [toImage(detail)] : [];
      return { items: images, page: 1, pageSize: images.length, hasMore: false };
    },

    getImage: async function (params, ctx) {
      var id = parseId((params && params.imageId) || '');
      if (!id) return null;

      var detail = await detailOf(ctx, id);
      return detail ? toImage(detail) : null;
    },

    /** \u5217\u8868\u7ED9\u7684\u662F 432px \u7F29\u7565\u56FE\uFF0Cpath \u624D\u662F\u4E0A\u4F20\u7684\u539F\u56FE\uFF08\u5206\u8FA8\u7387\u6700\u9AD8\uFF09\u3002 */
    getImageOriginal: async function (params, ctx) {
      var id = parseId((params && params.imageId) || '');
      if (!id) return null;

      var detail = await detailOf(ctx, id);
      return detail && detail.path ? detail.path : null;
    },

    getImageDetail: async function (params, ctx) {
      var id = parseId((params && params.imageId) || '');
      if (!id) return null;

      var detail = await detailOf(ctx, id);
      if (!detail) return null;

      var tags = tagNames(detail);
      return {
        title: detail.resolution || detail.id,
        description: tags.length ? tags.join(', ') : summaryOf(detail),
      };
    },

    /** \u6807\u7B7E\u4E91\u53D6 /tags/popular\uFF08Most Viewed \u7684\u9759\u6001\u9875\uFF09\uFF0C\u6807\u7B7E\u540D\u53EF\u76F4\u63A5\u5F53\u641C\u7D22\u8BCD\u3002 */
    getTags: async function (params, ctx) {
      var url = BASE + '/tags/popular';
      var response = await ctx.fetch(url);
      if (!response || response.status >= 400) {
        throw new Error('HTTP ' + (response && response.status) + ' ' + url);
      }

      var $ = ctx.$(response.text);
      var seen = {};
      return $('#taglist .taglist-name a')
        .map(function (index, element) {
          return $(element).text().trim();
        })
        .get()
        .filter(function (tag) {
          if (!tag || seen[tag]) return false;
          seen[tag] = true;
          return true;
        })
        .slice(0, TAGS_LIMIT);
    },
  });
})();
