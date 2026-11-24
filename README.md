# 上海地铁票价地图

点选或搜索起点，查看上海地铁 414 个运营站点的单程新票价。地图支持平移、缩放、票价档筛选，并可切换查看调价前后的差额。

## 在线演示

[打开上海地铁票价地图](https://qthe138.github.io/shanghai-metro-fare-map/)

[下载独立 HTML](https://github.com/qthe138/shanghai-metro-fare-map/releases/latest/download/shanghai-metro-fare-map.html)，可在浏览器离线查价。

新票价由 2026 年 12 月 1 日起执行。已核验的站间示例采用公布价格，其他站对按公开的区间里程和计价规则测算，列表中的「≈」表示测算值。磁浮线、金山铁路和市域机场线在图上标注为单独计价。

## 本地运行

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
node --test
```

打开 `http://127.0.0.1:4173/` 查看本地版本。线网来源、计算方式和发布操作见 [维护记录](MAINTENANCE.md)。
