
(function () {
  var BASE = 'https://bobopic.com';
  var PLUGIN_ID = 'bobopic';
  var PAGE_SIZE = 24;
  var ENRICH_CONCURRENCY = 6;

  var detailCache = {};
  var imagePageCache = {};

  function txt($el) {
    return $el && $el.length ? $el.text().trim().replace(/\s+/g, ' ') : '';
  }

  function abs(href) {
    try {
      return new URL(href, BASE).href;
    } catch (error) {
      return href || '';
    }
  }

  function parseTotal(value) {
    var total = /\u5171\s*(\d+)\s*\u5F20/.exec(value || '');
    if (total) return Number(total[1]);
    var single = /(\d+)\s*\u5F20/.exec(value || '');
    return single ? Number(single[1]) : undefined;
  }

  function parseTimestamp(value) {
    if (!value) return undefined;
    var full = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (full) return Date.parse(full[1] + '-' + full[2] + '-' + full[3] + 'T00:00:00+08:00');
    var short = /(\d{2})-(\d{2})/.exec(value);
    if (short) {
      return Date.parse(new Date().getFullYear() + '-' + short[1] + '-' + short[2] + 'T00:00:00+08:00');
    }
    return undefined;
  }

  function bgUrl(style) {
    var match = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(style || '');
    return match ? match[1] : undefined;
  }

  function slugOf(url) {
    var full = abs(url);
    var match = /\/([^/]+)\.html/.exec(full);
    return match ? match[1] : full;
  }

  async function fetchPage(ctx, pathname) {
    var url = pathname.indexOf('http') === 0 ? pathname : BASE + pathname;
    var response = await ctx.fetch(url);
    if (!response || response.status >= 400) {
      throw new Error('HTTP ' + (response && response.status) + ' ' + url);
    }
    return { $: ctx.$(response.text), html: response.text };
  }

  async function load(ctx, pathname) {
    var page = await fetchPage(ctx, pathname);
    return page.$;
  }

  function toAlbum(input) {
    var url = abs(input.url);
    return {
      id: slugOf(url),
      pluginId: PLUGIN_ID,
      title: (input.title || '').trim(),
      coverUrl: input.cover,
      imageCount: input.count || 0,
      tags: input.tags || [],
      createdAt: input.date,
      sourceUrl: url,
    };
  }

  function parseRichList($) {
    return $('article.grid-item')
      .map(function (index, element) {
        var $item = $(element);
        var title = txt($item.find('.entry-title'));
        var category = txt($item.find('.cat-links'));
        return toAlbum({
          url: $item.find('a').first().attr('href'),
          cover: bgUrl($item.find('.post').attr('style')) || bgUrl($item.attr('style')),
          title: title,
          count: parseTotal(title) || parseTotal(txt($item.find('.pixivisgood'))),
          tags: category ? [category] : [],
          date: parseTimestamp(txt($item.find('.indextags'))),
        });
      })
      .get();
  }

  function parseGrid($) {
    return $('.grid-item')
      .map(function (index, element) {
        var $item = $(element);
        return toAlbum({
          url: $item.find('a').first().attr('href'),
          cover: $item.find('img').attr('src'),
          title: txt($item.find('.kuoSCM')),
        });
      })
      .get();
  }

  function parseFeatured($) {
    return $('.featured-post')
      .map(function (index, element) {
        var $item = $(element);
        var $time = $item.find('time');
        var category = txt($item.find('.entry-category'));
        return toAlbum({
          url: $item.find('a.u-permalink').attr('href') || $item.find('a.kapian').attr('href'),
          cover: bgUrl($item.attr('style')),
          title: txt($item.find('.entry-title')),
          tags: category ? [category] : [],
          date: parseTimestamp($time.attr('datetime') || txt($time)),
        });
      })
      .get();
  }

  function parseDetail($, sourceUrl) {
    var title = txt($('h1').first());
    var $time = $('time').first();
    var tags = $('.entry-tags a')
      .map(function (index, element) {
        return txt($(element));
      })
      .get()
      .filter(Boolean);
    var images = $('.entry-content img')
      .map(function (index, element) {
        return $(element).attr('src');
      })
      .get()
      .filter(Boolean);
    var slug = slugOf(sourceUrl);

    return {
      album: {
        id: slug,
        pluginId: PLUGIN_ID,
        title: title,
        coverUrl: images[0],
        imageCount: parseTotal(title) || images.length,
        tags: tags,
        createdAt: parseTimestamp($time.attr('datetime') || txt($time)),
        sourceUrl: abs(sourceUrl),
      },
      rankingUrl: $('.entry-shuishuo a.shuishuoa').attr('href') || null,
      images: images.map(function (src) {
        return {
          id: pidOf(src),
          pluginId: PLUGIN_ID,
          title: '',
          url: src,
          thumbnailUrl: src,
          tags: tags,
          albumId: slug,
        };
      }),
    };
  }

  /** \u4ECE\u56FE\u7247\u5730\u5740\u91CC\u53D6\u51FA pixiv PID\uFF0C\u4F5C\u4E3A\u5355\u56FE id\uFF0C\u4E5F\u7528\u4E8E\u53D6\u539F\u56FE\u3002 */
  function pidOf(src) {
    var match = /\/(\d+)\.jpg/.exec(src || '');
    return match ? match[1] : src;
  }

  /**
   * \u5355\u56FE id \u5C31\u662F\u7EAF\u6570\u5B57\u7684 pixiv PID\u3002\u5176\u5B83\u56FE\u6E90\u7684 id\uFF08\u4F8B\u5982\u6B21\u5143\u753B\u518C\u7684
   * 149712797_p0 \u8FD9\u79CD\u5F62\u5F0F\uFF09\u957F\u5F97\u50CF PID\uFF0C\u5FC5\u987B\u62D2\u6389\uFF0C\u5426\u5219\u4F1A\u62FF\u522B\u4EBA\u7684 id \u53BB\u89E3\u6790\u51FA
   * \u4E00\u5F20\u4E0D\u5C5E\u4E8E\u672C\u7AD9\u7684\u56FE\uFF08\u6216\u76F4\u63A5 401\uFF09\u3002
   */
  function isPid(imageId) {
    return /^\d+$/.test(imageId);
  }

  /** \u699C\u5355\u9875\uFF08/daily?date=...\uFF09\u624D\u662F\u5B8C\u6574\u5957\u56FE\uFF0C\u6570\u91CF\u8FDC\u591A\u4E8E\u6587\u7AE0\u5185\u9884\u89C8\u3002 */
  function parseDailyImages($, albumId, tags) {
    return $('.grid-item img')
      .map(function (index, element) {
        var src = $(element).attr('src');
        if (!src) return null;
        return {
          id: pidOf(src),
          pluginId: PLUGIN_ID,
          title: '',
          url: src,
          thumbnailUrl: src,
          tags: tags,
          albumId: albumId,
        };
      })
      .get()
      .filter(Boolean);
  }

  async function getDetail(ctx, albumId) {
    if (detailCache[albumId]) return detailCache[albumId];
    var pathname = '/' + albumId + '.html';
    var $ = await load(ctx, pathname);
    var detail = parseDetail($, BASE + pathname);
    detailCache[albumId] = detail;
    return detail;
  }

  /** \u5355\u56FE\u9875\uFF1A\u542B\u8BE5\u56FE\u81EA\u5DF1\u7684\u6807\u9898\u3001\u4ECB\u7ECD\uFF08.newpixiv\uFF09\u4E0E\u6807\u7B7E\u3002 */
  async function getImagePage(ctx, imageId) {
    if (imagePageCache[imageId]) return imagePageCache[imageId];
    var $ = await load(ctx, '/' + imageId + '.html');
    var page = {
      id: imageId,
      title: txt($('h1').first()),
      description: txt($('.newpixiv').first()) || txt($('.goodbobopic').first()),
      thumbnailUrl: $('.entry-content img').first().attr('src') || null,
      tags: $('.entry-tags a')
        .map(function (index, element) {
          return txt($(element));
        })
        .get()
        .filter(Boolean),
    };
    imagePageCache[imageId] = page;
    return page;
  }

  /** \u641C\u7D22\u7ED3\u679C\u53EA\u6709\u5C01\u9762\u548C\u6807\u9898\uFF0C\u8FDB\u8BE6\u60C5\u9875\u8865\u5168\u6570\u91CF / \u65E5\u671F / \u6807\u7B7E\u3002 */
  async function enrich(ctx, albums) {
    var output = albums.slice();
    var cursor = { value: 0 };

    async function worker() {
      while (cursor.value < output.length) {
        var index = cursor.value;
        cursor.value += 1;
        try {
          var detail = await getDetail(ctx, output[index].id);
          output[index].imageCount = detail.album.imageCount;
          output[index].tags = detail.album.tags;
          output[index].createdAt = detail.album.createdAt;
          if (!output[index].coverUrl) output[index].coverUrl = detail.album.coverUrl;
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

  window.iriso.registerSource({
    id: PLUGIN_ID,

    /** \u6240\u6709\u63D2\u4EF6\u5171\u7528\u7684\u4E09\u4E2A\u5165\u53E3\uFF1A\u6700\u65B0 / \u6700\u70ED / \u63A8\u8350\uFF08\u652F\u6301\u7FFB\u9875\uFF09\u3002 */
    getDiscoveryList: async function (params, ctx) {
      var kind = (params && params.kind) || 'latest';
      var page = (params && params.page) || 1;

      if (kind === 'recommended') {
        var $home = await load(ctx, '/');
        var featured = parseFeatured($home);
        return { items: featured, page: 1, pageSize: featured.length, hasMore: false };
      }

      if (kind === 'hot') {
        var hotResult = await fetchPage(ctx, page <= 1 ? '/' : '/list/' + page + '/');
        var hot = parseRichList(hotResult.$);
        return {
          items: hot,
          page: page,
          pageSize: hot.length,
          hasMore: hotResult.$('a.next.page-numbers').length > 0,
        };
      }

      var newResult = await fetchPage(
        ctx,
        page <= 1 ? '/category/newillust' : '/category/newillust/list/' + page + '/'
      );
      var fresh = parseGrid(newResult.$);
      return {
        items: fresh,
        page: page,
        pageSize: fresh.length,
        hasMore: newResult.$('a.next.page-numbers').length > 0,
      };
    },

    searchAlbums: async function (params, ctx) {
      var keyword = (params && params.keyword) || '';
      var page = (params && params.page) || 1;
      var url = BASE + '/tag/' + encodeURIComponent(keyword) + '/list/' + page;
      var response = await ctx.fetch(url);
      if (!response || response.status >= 400) {
        throw new Error('HTTP ' + (response && response.status) + ' ' + url);
      }

      var $ = ctx.$(response.text);
      var totalMatch = /totalPage\s*=\s*(\d+)/.exec(response.text);
      var totalPage = totalMatch ? Number(totalMatch[1]) : page;
      var albums = await enrich(ctx, parseGrid($));

      return {
        items: albums,
        page: page,
        pageSize: PAGE_SIZE,
        hasMore: page < totalPage,
        total: totalPage * PAGE_SIZE,
      };
    },

    getAlbum: async function (params, ctx) {
      var detail = await getDetail(ctx, (params && params.albumId) || '');
      return detail.album;
    },

    getImage: async function (params, ctx) {
      var imageId = (params && params.imageId) || '';
      if (!isPid(imageId)) return null;

      var page = await getImagePage(ctx, imageId);
      if (!page.thumbnailUrl) return null;
      return {
        id: imageId,
        pluginId: PLUGIN_ID,
        title: page.title,
        url: page.thumbnailUrl,
        thumbnailUrl: page.thumbnailUrl,
        tags: page.tags,
      };
    },

    getImageDetail: async function (params, ctx) {
      var imageId = (params && params.imageId) || '';
      if (!isPid(imageId)) return null;

      var page = await getImagePage(ctx, imageId);
      return { title: page.title, description: page.description };
    },

    getAlbumImages: async function (params, ctx) {
      var albumId = (params && params.albumId) || '';
      var detail = await getDetail(ctx, albumId);
      var images = detail.images;

      // pixiv \u699C\u5355\u5957\u56FE\uFF1A\u6587\u7AE0\u5185\u53EA\u6709\u9884\u89C8\uFF0C\u5B8C\u6574\u699C\u5355\u5728 /daily?date=...
      // Ranking sets: the article only carries previews, the full list lives on
      // /daily?date=... Users can turn that extra request off in plugin settings.
      if (detail.rankingUrl && (ctx.settings || {}).dailyRanking !== false) {
        try {
          var $daily = await load(ctx, detail.rankingUrl);
          var dailyImages = parseDailyImages($daily, albumId, detail.album.tags);
          if (dailyImages.length > images.length) images = dailyImages;
        } catch (error) {
          // \u56DE\u9000\u5230\u6587\u7AE0\u5185\u9884\u89C8\u56FE
        }
      }

      return { items: images, page: 1, pageSize: images.length, hasMore: false };
    },

    /** \u901A\u8FC7 go \u9875\u53D6\u539F\u56FE\uFF1A\u9ED8\u8BA4\u5C55\u793A\u7684 small \u56FE\u70B9\u51FB\u540E\u53EF\u6362\u539F\u56FE\u3002 */
    getImageOriginal: async function (params, ctx) {
      var imageId = (params && params.imageId) || '';
      if (!isPid(imageId)) return null;

      var $ = await load(ctx, 'https://go.bobopic.com/' + imageId);
      var src = $('#main-img').attr('src');
      if (!src) throw new Error('original not found: ' + imageId);
      return src;
    },

    getTags: async function (params, ctx) {
      var $ = await load(ctx, '/tagcloud');
      var seen = {};
      return $('a[href*="/tag/"]')
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
