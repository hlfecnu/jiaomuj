# 酵母合成生物学文献库

一个用 Europe PMC 公开接口自动搜集 2020 年以来 CNS 正刊及 Cell/Nature/Science 系列子刊中酵母与合成生物学文献的网站。

公网地址：<https://hlfecnu.github.io/jiaomuj/>

## 使用方式

```powershell
npm start
```

然后打开终端里显示的网址。服务默认尝试 `http://127.0.0.1:5174`，如果端口被占用会自动递增到 `5175`、`5176` 等。

也可以双击 `start.bat`。另一台设备需要先安装 Node.js 18 或更新版本。

## 自动更新

GitHub Actions 每天北京时间 09:00 自动更新公网数据。本地服务启动后也会把下一次自动更新排到明天 09:00，之后每天 09:00 更新一次。更新时会：

- 调用 Europe PMC 搜集文献
- 生成中文标题和中文摘要
- 保存到 `data/literature.json`
- 缓存翻译到 `data/translation-cache.json`
- 在页面里提供 DOI、PubMed 和原文跳转链接

页面支持：

- 编辑期刊池、酵母关键词、合成生物学关键词
- 严格或宽松检索模式
- 自动去重、按日期排序
- 中文标题、摘要、作者、期刊、DOI 过滤
- CSV 和 JSON 导出
- 服务端本地缓存上次结果

公网版点击“重新加载”会读取 GitHub 上已更新的数据；自定义检索参数和“立即更新”功能保留在本地 Node 服务中。

默认数据源是 Europe PMC REST API，不需要 API key。中文翻译使用公开翻译端点，首次全量翻译会比普通检索慢。
