const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://graphrace-studio.com';
const EXCLUDE_DIRS = ['.git', '.claude', 'shared', 'node_modules', 'app'];
const EXCLUDE_FILES = [];

function getHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(file)) {
        getHtmlFiles(filePath, fileList);
      }
    } else if (stat.isFile()) {
      if (file.endsWith('.html') && !EXCLUDE_FILES.includes(file)) {
        fileList.push({
          path: filePath,
          mtime: stat.mtime
        });
      }
    }
  }
  return fileList;
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function generateSitemap() {
  const rootDir = __dirname;
  const htmlFiles = getHtmlFiles(rootDir);
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  
  // Sort by priority (descending) to make sitemap clean
  const items = [];
  
  for (const fileInfo of htmlFiles) {
    const relativePath = path.relative(rootDir, fileInfo.path).replace(/\\/g, '/');
    let urlPath = '';
    let priority = '0.5';
    let changefreq = 'monthly';
    
    if (relativePath === 'index.html') {
      urlPath = '/';
      priority = '1.0';
    } else if (relativePath.endsWith('index.html')) {
      urlPath = '/' + relativePath.substring(0, relativePath.length - 10);
      priority = '0.8';
    } else {
      urlPath = '/' + relativePath;
      if (relativePath === 'privacy.html' || relativePath === 'terms.html') {
        priority = '0.3';
      } else if (relativePath === 'about.html') {
        priority = '0.5';
      } else {
        priority = '0.6';
      }
    }
    
    const url = `${DOMAIN}${urlPath}`;
    const lastmod = formatDate(fileInfo.mtime);
    
    items.push({ url, lastmod, changefreq, priority });
  }
  
  // Sort items so 1.0 is first, then 0.8, etc.
  items.sort((a, b) => parseFloat(b.priority) - parseFloat(a.priority));
  
  for (const item of items) {
    xml += '  <url>\n';
    xml += `    <loc>${item.url}</loc>\n`;
    xml += `    <lastmod>${item.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${item.changefreq}</changefreq>\n`;
    xml += `    <priority>${item.priority}</priority>\n`;
    xml += '  </url>\n';
  }
  
  xml += '</urlset>\n';
  
  fs.writeFileSync(path.join(rootDir, 'sitemap.xml'), xml);
  console.log('sitemap.xml has been successfully generated!');
}

generateSitemap();
