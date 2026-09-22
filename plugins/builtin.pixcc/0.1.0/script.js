
(function () {
  var BASE = 'https://www.pixcc.net';
  var CDN = 'https://cdn.pixcc.net';
  var PLUGIN_ID = 'builtin.pixcc';

  // \u8BE6\u60C5\u9875\u7EA6 260KB\uFF0C\u53EA\u4E3A\u641C\u7D22\u7ED3\u679C\u7684\u524D\u82E5\u5E72\u6761\u8865\u5168\u65E5\u671F/\u6807\u7B7E\u3002
  var ENRICH_LIMIT = 12;
  var ENRICH_CONCURRENCY = 4;

  /** Reads a non-negative numeric setting, falling back to the default. */
  function numberSetting(ctx, key, fallback) {
    var value = Number(ctx && ctx.settings ? ctx.settings[key] : undefined);
    return isFinite(value) && value >= 0 ? value : fallback;
  }

  var illustCache = {};
  var albumCache = {};

  function txt($el) {
    return $el && $el.length ? $el.text().trim().replace(/\s+/g, ' ') : '';
  }

  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodeAstro(value) {
    if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === 'number' && value[0] <= 2) {
        return decodeAstro(value[1]);
      }
      return value.map(decodeAstro);
    }
    if (value && typeof value === 'object') {
      var output = {};
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) output[key] = decodeAstro(value[key]);
      }
      return output;
    }
    return value;
  }

  function parseIsland($, exportName) {
    var island = $('astro-island[component-export="' + exportName + '"]').first();
    if (!island.length) return null;
    var raw = island.attr('props');
    if (!raw) return null;
    try {
      return decodeAstro(JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
    } catch (error) {
      return null;
    }
  }

  async function fetchPage(ctx, path) {
    var url = path.indexOf('http') === 0 ? path : BASE + path;
    var response = await ctx.fetch(url);
    if (!response || response.status >= 400) {
      throw new Error('HTTP ' + (response && response.status) + ' ' + url);
    }
    return { $: ctx.$(response.text), html: response.text };
  }

  async function load(ctx, path) {
    var page = await fetchPage(ctx, path);
    return page.$;
  }

  function tagNames(data) {
    return (data && data.tags ? data.tags : [])
      .map(function (tag) {
        return tag && tag[1];
      })
      .filter(Boolean);
  }

  async function illustData(ctx, id) {
    if (illustCache[id] !== undefined) return illustCache[id];
    var $ = await load(ctx, '/illust/' + id);
    var props = parseIsland($, 'IllustViewer');
    illustCache[id] = props && props.illust ? props.illust : null;
    return illustCache[id];
  }

  function toIllustAlbum(id, data) {
    var tags = tagNames(data);
    var thumb = data.imgs && data.imgs.thumb ? CDN + '/small/' + data.imgs.thumb : undefined;
    return {
      id: 'illust-' + id,
      pluginId: PLUGIN_ID,
      title: data.title || '',
      coverUrl: thumb,
      imageCount: data.n_page || 0,
      tags: tags,
      description: cleanText(data.caption) || undefined,
      createdAt: data.created ? Date.parse(data.created) : undefined,
    };
  }

  function toIllustImages(id, data) {
    var tags = tagNames(data);
    var largeUrls = data.large_urls || [];
    var total = Math.max(data.n_page || 0, largeUrls.length);
    var thumb = data.imgs && data.imgs.thumb ? CDN + '/small/' + data.imgs.thumb : undefined;
    var images = [];

    for (var index = 0; index < total; index += 1) {
      var large = largeUrls[index] || CDN + '/large/' + id + '_p' + index + '_1200.webp';
      images.push({
        id: id + '_p' + index,
        pluginId: PLUGIN_ID,
        title: '',
        url: large,
        thumbnailUrl: index === 0 && thumb ? thumb : large,
        tags: tags,
        albumId: 'illust-' + id,
      });
    }

    return images;
  }

  async function albumData(ctx, id) {
    if (albumCache[id]) return albumCache[id];
    var $ = await load(ctx, '/album/' + id);
    var images = [];
    var seen = {};

    $('img[src*="cdn.pixcc.net/album/"]').each(function (index, element) {
      var src = $(element).attr('src');
      if (!src || seen[src]) return;
      seen[src] = true;
      images.push({
        id: 'album_' + id + '_' + images.length,
        pluginId: PLUGIN_ID,
        title: '',
        url: src,
        thumbnailUrl: src,
        albumId: 'album-' + id,
      });
    });

    var countMatch = /(\d+)\s*P/i.exec(txt($('body')));
    albumCache[id] = {
      album: {
        id: 'album-' + id,
        pluginId: PLUGIN_ID,
        title: txt($('h1').first()),
        coverUrl: images[0] ? images[0].url : undefined,
        imageCount: countMatch ? Number(countMatch[1]) : images.length,
        tags: [],
      },
      images: images,
    };
    return albumCache[id];
  }

  function parseIllustList($) {
    return $('a[href^="/illust/"]')
      .map(function (index, element) {
        var $item = $(element);
        var match = /\/illust\/(\d+)/.exec($item.attr('href') || '');
        if (!match) return null;

        var $img = $item.find('img').first();
        var countMatch = /(\d+)/.exec(txt($item.find('span.absolute.top-2.right-2')));
        var aspectText = $item.find('[style*="aspect-ratio"]').first().attr('style') || '';
        var aspectMatch = /aspect-ratio:\s*([0-9.]+)/.exec(aspectText);

        return {
          id: 'illust-' + match[1],
          pluginId: PLUGIN_ID,
          title: ($img.attr('alt') || '').trim(),
          coverUrl: $img.attr('src') || undefined,
          imageCount: countMatch ? Number(countMatch[1]) : 1,
          tags: [],
          aspectRatio: aspectMatch ? Number(aspectMatch[1]) : undefined,
        };
      })
      .get()
      .filter(Boolean);
  }

  /** \u5217\u8868\u5361\u7247\u6CA1\u6709\u65E5\u671F/\u6807\u7B7E\uFF0C\u8FDB\u8BE6\u60C5\u9875\u8865\u5168\uFF08\u53EA\u8865\u524D ENRICH_LIMIT \u6761\uFF09\u3002 */
  async function enrich(ctx, albums, limit) {
    var output = albums.slice();
    var max = Math.min(limit, output.length);
    var cursor = { value: 0 };

    async function worker() {
      while (cursor.value < max) {
        var index = cursor.value;
        cursor.value += 1;

        var albumId = output[index].id;
        if (albumId.indexOf('illust-') !== 0) continue;
        var id = albumId.slice('illust-'.length);

        try {
          var data = await illustData(ctx, id);
          if (!data) continue;
          if (data.n_page) output[index].imageCount = data.n_page;
          output[index].tags = tagNames(data);
          if (data.created) output[index].createdAt = Date.parse(data.created);
        } catch (error) {
          // \u8BE6\u60C5\u5931\u8D25\u65F6\u4FDD\u7559\u5217\u8868\u9875\u5B57\u6BB5
        }
      }
    }

    var workers = [];
    for (var i = 0; i < ENRICH_CONCURRENCY; i += 1) workers.push(worker());
    await Promise.all(workers);
    return output;
  }

  window.iriso.registerSource({
    id: PLUGIN_ID,

    /** \u6240\u6709\u63D2\u4EF6\u5171\u7528\u7684\u4E09\u4E2A\u5165\u53E3\uFF1A\u6700\u65B0 / \u6700\u70ED / \u63A8\u8350\uFF08\u652F\u6301\u7FFB\u9875\uFF09\u3002 */
    getDiscoveryList: async function (params, ctx) {
      var kind = (params && params.kind) || 'latest';
      var page = (params && params.page) || 1;
      var order = kind === 'hot' ? 'n_bookmark' : kind === 'recommended' ? 'n_view' : 'added';

      var result = await fetchPage(ctx, '/illust?order=' + order + '&page=' + page);
      var albums = parseIllustList(result.$);
      return {
        items: albums,
        page: page,
        pageSize: albums.length,
        hasMore: result.$('a[href*="page="]').length > 0,
      };
    },

    searchAlbums: async function (params, ctx) {
      var keyword = (params && params.keyword) || '';
      var page = (params && params.page) || 1;
      var path =
        '/search?q=' + encodeURIComponent(keyword) + '&page=' + page + '&stype=illust';

      var result = await fetchPage(ctx, path);
      var limit = numberSetting(ctx, 'enrichLimit', ENRICH_LIMIT);
      var albums = await enrich(ctx, parseIllustList(result.$), limit);
      var hasMore = result.$('a[href*="page="]').length > 0;

      return { items: albums, page: page, pageSize: albums.length, hasMore: hasMore };
    },

    getAlbum: async function (params, ctx) {
      var albumId = (params && params.albumId) || '';

      if (albumId.indexOf('album-') === 0) {
        var albumResult = await albumData(ctx, albumId.slice('album-'.length));
        return albumResult.album;
      }

      var id = albumId.replace('illust-', '');
      var data = await illustData(ctx, id);
      return data ? toIllustAlbum(id, data) : null;
    },

    getAlbumImages: async function (params, ctx) {
      var albumId = (params && params.albumId) || '';

      if (albumId.indexOf('album-') === 0) {
        var albumResult = await albumData(ctx, albumId.slice('album-'.length));
        return {
          items: albumResult.images,
          page: 1,
          pageSize: albumResult.images.length,
          hasMore: false,
        };
      }

      var id = albumId.replace('illust-', '');
      var data = await illustData(ctx, id);
      var images = data ? toIllustImages(id, data) : [];
      return { items: images, page: 1, pageSize: images.length, hasMore: false };
    },

    getImage: async function (params, ctx) {
      var imageId = (params && params.imageId) || '';
      var match = /^(\d+)_p(\d+)$/.exec(imageId);

      if (match) {
        var data = await illustData(ctx, match[1]);
        if (!data) return null;
        return toIllustImages(match[1], data)[Number(match[2])] || null;
      }

      // Cosplay \u4E13\u8F91\uFF1Aid \u5F62\u5982 album_<albumId>_<index>\u3002
      var albumMatch = /^album_(.+)_(\d+)$/.exec(imageId);
      if (albumMatch) {
        var albumResult = await albumData(ctx, albumMatch[1]);
        return albumResult.images[Number(albumMatch[2])] || null;
      }

      return null;
    },

    getImageOriginal: async function (params, ctx) {
      var imageId = (params && params.imageId) || '';

      // \u63D2\u753B\uFF1A\u7AD9\u70B9\u7684 origin\uFF08\u771F\u539F\u56FE\uFF09\u9700\u8981\u767B\u5F55\u4E14\u8FD4\u56DE 401\uFF0Clarge \u7684 1200 \u5C31\u662F\u514D\u767B\u5F55
      // \u53EF\u7528\u7684\u6700\u9AD8\u6E05\u6670\u5EA6\uFF0C\u4E5F\u6B63\u662F\u5217\u8868\u91CC\u5DF2\u7ECF\u7ED9\u8FC7\u7684\u90A3\u5F20\u56FE\uFF0C\u6240\u4EE5\u76F4\u63A5\u590D\u7528\u540C\u4E00\u4E2A\u6765\u6E90\u3002
      var match = /^(\d+)_p(\d+)$/.exec(imageId);
      if (match) {
        var data = await illustData(ctx, match[1]);
        var images = data ? toIllustImages(match[1], data) : [];
        var image = images[Number(match[2])];
        return image ? image.url : CDN + '/large/' + imageId + '_1200.webp';
      }

      // Cosplay \u4E13\u8F91\uFF1A\u4E13\u8F91\u9875\u91CC\u7684\u56FE\u7247\u672C\u8EAB\u5C31\u662F\u539F\u56FE\uFF0C\u76F4\u63A5\u590D\u7528\u3002
      var albumMatch = /^album_(.+)_(\d+)$/.exec(imageId);
      if (albumMatch) {
        var albumResult = await albumData(ctx, albumMatch[1]);
        var albumImage = albumResult.images[Number(albumMatch[2])];
        return albumImage ? albumImage.url : null;
      }

      return null;
    },

    getImageDetail: async function (params, ctx) {
      var imageId = (params && params.imageId) || '';
      var match = /^(\d+)_p(\d+)$/.exec(imageId);
      if (!match) return null;

      var data = await illustData(ctx, match[1]);
      if (!data) return null;
      return { title: data.title || '', description: cleanText(data.caption) };
    },

    getTags: async function (params, ctx) {
      var $ = await load(ctx, '/tag');
      var seen = {};
      return $('a[href^="/tag/"] h3')
        .map(function (index, element) {
          return txt($(element));
        })
        .get()
        .filter(function (tag) {
          if (!tag || seen[tag]) return false;
          seen[tag] = true;
          return true;
        })
        .slice(0, 60);
    },
  });
})();
