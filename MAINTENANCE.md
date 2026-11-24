# 维护记录

## 2026-11-25｜上线上海地铁票价地图

- 实现点图或搜索设置起点、地图放大和平移、目的站查价、票价档筛选，以及新票价和涨幅切换。默认起点为虹桥火车站。
- 线网包括 1–18 号线和浦江线，共 414 个可作为起点的去重地铁站。按上海地铁官方站点编码目录逐一对照高德示意坐标，磁浮、市域机场线与金山铁路在图上单独标注。换乘站合并为一点，国家会展中心的 2 号线与 17 号线车站分别保留。只收录当前已开通车站。 [上海地铁站点页](https://m.shmetro.com/workspace/shmetrotest/view_csdt.aspx) · [站点编码目录](https://m.shmetro.com/core/shmetro/mdstationinfoback.ashx?act=getAllStations) · [高德线网示意数据](https://webapi.amap.com/subway/data/3100_drw_shanghai.json)
- 新票价使用沪发改价调〔2026〕58 号的分段阈值，旧票价使用旧版基准里程档。区间长度取各线路的公开站间里程表，按最短路径求和。列表以「≈」标记未取得确切新票价的站对。官网新查询在当前环境要求通过手机重新扫码，无法核验整张官方新票价表。 [新票价复函](https://fgw.sh.gov.cn/fgw_jjjctk/20261123/f57b63885c514c829ee269ed589ab2b9.html) · [旧票价及最短路径规则](https://service.shmetro.com/cpxz/3983.htm) · [官方查询公告](https://cmp.whlyj.sh.gov.cn/CMP/news_view.ac?id=cfc0e0dc94c54753b93fccb733bccc5a) · [线路里程公开汇编](https://zh.wikipedia.org/wiki/上海地铁车站列表)
- 三组公开的新旧价格与计算值一致。另抽查上海地铁旧版查询，取得 16 条有效站对，模型原值与其中 15 条一致。验证结果写入站对数据，莘庄至人民广场以实查旧票价 4 元覆盖模型基准价。 [公开票价示例](https://sh.people.com.cn/n2/2026/1124/c176737-41759932.html) · [旧版官方查询](https://service.shmetro.com/cphc/index.htm)
- 运行 `node --test` 检查计价边界、已公布站对、414 个站点的全网可达性和新开线路。用 Codex 预览检查了键盘搜站、手机布局和点站、涨幅切换及数据说明。

### 更新数据

保留原始来源文件在项目外的工作目录。以该目录作为第一个参数，运行 `python3 scripts/build-network.py <来源目录> dist/network.json`。生成器需要 Python、pandas 和 lxml。它读取官方站点编码与线路颜色、高德线网 JSON、维基各线路条目的公开里程表及可选旧价抽查样本。文件名在生成器里列明。更新时对照当日官方目录，检查覆盖率及特殊换乘站，并更新快照日期和页面说明。具备可用的官方站间价表后，应直接采用官方数据。

## 2026-11-25｜发布 GitHub Pages

- 将网站、测试和维护文档提交到 `main`，用 `dist/` 生成独立的 `gh-pages` 发布分支。
- GitHub Pages 从 `gh-pages` 根目录提供静态文件。`dist/.nojekyll` 用于直接提供构建产物，页面使用相对链接以适配项目路径。
- 后续在 `main` 提交并通过 `node --test` 后，先推送 `main`，再运行 `git subtree push --prefix=dist origin gh-pages`，并检查 GitHub Pages 部署和线上交互。

## 2026-11-25｜补充独立 HTML 下载

- GitHub Pages 的 `gh-pages` 分支构建成功，项目地址继承账号主页绑定的 `www.limoshi.shop`。发布时公共 DNS 查询返回域名不存在。
- 用 `python3 scripts/build-offline.py <输出文件.html>` 生成可直接在浏览器打开的独立 HTML。此文件内嵌代码、样式与快照数据，发布在 GitHub Releases 中。

## 2026-11-25｜恢复在线演示入口

- 账号主页解绑旧域名后，项目恢复使用 GitHub Pages 默认地址。README 的「在线演示」和仓库 About 栏的网站链接指向该地址。 [上海地铁票价地图](https://qthe138.github.io/shanghai-metro-fare-map/)
- 已在公开演示中验证虹桥火车站至南京东路显示新票价 7 元，切换「涨幅」显示上涨 2 元。
