/**
 * copy-static.js — 构建后复制静态文件到 dist/
 *
 * tsup 只处理 .ts 文件的打包，HTML/CSS/图标等静态资源
 * 需要单独复制到 dist/ 目录旁边，这样 Chrome 才能加载。
 *
 * 注意：manifest.json 和 popup.html 留在项目根目录，
 * Chrome 加载未打包扩展时以 manifest.json 所在目录为根。
 * 所以 dist/ 里的 JS 已经在正确位置了。
 */

// 这个脚本目前不需要复制任何文件，因为：
// - manifest.json 在项目根目录（Chrome 以此为扩展根）
// - popup.html 也在项目根目录
// - dist/*.js 由 tsup 生成
// - icons/ 在项目根目录
//
// 如果将来需要复制文件，在这里添加逻辑。
console.log("Static files OK — manifest.json and popup.html are in extension root.");
