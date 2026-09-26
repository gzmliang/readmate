# pdf.js（本地内置，不联网）

- 来源：npm `pdfjs-dist@3.11.174` 的 `legacy/build`（UMD，兼容 MV3 CSP，无 eval）
- 用途：读伴书页（reader.html）导入 PDF 时提取**文字层**，转成流式书页
- 许可：Apache-2.0（见 `LICENSE`）
- 注意：`pdf.worker.min.js` 是独立 Worker，`cmaps/` 与 `standard_fonts/` 供中日韩 PDF 的
  预定义 CMap / 标准 14 字体使用（缺了会导致中文 PDF 抽出乱码或空文本）
- 升级方式：`npm pack pdfjs-dist@<版本>` 后覆盖本目录同名文件即可
