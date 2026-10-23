// GraphRace Studio — Astro 設定
//
// ・Astro が扱うのは src/pages/ のページだけ（多言語化するSEOページから順に移す）。
// ・まだ移していない既存HTML・ツール画面・画像はリポジトリ直下のまま。
//   ビルド時は build/postbuild.mjs が dist にコピーし、開発サーバーでは下のミドルウェアが配信する。
import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE, LOCALE_CODES, SITE_URL } from './src/i18n/config.mjs';
import { ROOT, isServableLegacy } from './build/legacy-files.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.glb': 'model/gltf-binary',
  '.csv': 'text/csv; charset=utf-8', '.wasm': 'application/wasm',
};

// 開発サーバーで、Astro に無いURLを直下の既存ファイルから返す
function legacyStatic() {
  return {
    name: 'grs-legacy-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
          if (rel === '' || rel.endsWith('/')) rel += 'index.html';
          // Astro のページがあればそちらに任せる
          const astroPage = path.join(ROOT, 'src/pages', rel.replace(/\.html$/, '.astro'));
          if (fs.existsSync(astroPage)) return next();
          if (!isServableLegacy(rel)) return next();
          let abs = path.join(ROOT, rel);
          if (!abs.startsWith(ROOT + path.sep)) return next();
          if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
            res.statusCode = 301;
            res.setHeader('Location', url.pathname + '/');
            return res.end();
          }
          if (!fs.existsSync(abs)) return next();
          res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
          fs.createReadStream(abs).pipe(res);
        } catch (e) {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  site: SITE_URL,
  outDir: './dist',
  publicDir: './public',
  trailingSlash: 'ignore',
  // 既存ページのHTMLをそのまま移すので、空白の詰めは行わない
  compressHTML: false,
  build: {
    // src/pages/about.astro → about.html、src/pages/blog/index.astro → blog/index.html（今のURLのまま）
    format: 'preserve',
    inlineStylesheets: 'always',
  },
  i18n: {
    defaultLocale: DEFAULT_LOCALE,
    locales: LOCALE_CODES,
    routing: {
      prefixDefaultLocale: false, // 日本語はルート、他の言語は /en/ など
      redirectToDefaultLocale: false,
    },
  },
  devToolbar: { enabled: false },
  vite: {
    plugins: [legacyStatic()],
  },
});
