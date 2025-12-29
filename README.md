# Runback - 运动轨迹回放

Runback 是一个基于 Web 的运动轨迹回放工具，支持可视化展示和动态回放跑步、骑行等运动数据。它能够解析常见的运动文件格式（FIT, TCX, GPX），并在高德地图上精准还原运动路线，同时提供配速、心率、海拔等关键数据的同步分析图表。

特别针对中国地区进行了坐标偏移修正（WGS-84 转 GCJ-02），确保轨迹在地图上精准显示。

![Runback Hero](assets/runner-hero.png)

## ✨ 主要功能

*   **多格式支持**: 原生解析 `.fit`, `.tcx`, `.gpx` 运动文件，无需依赖后端转换。
*   **轨迹动态回放**: 支持 1x 到 240x 倍速播放，实时展示当前位置、时间、距离等信息。
*   **多文件对比**: 支持同时加载最多 4 个运动文件，同屏对比不同用户或不同日期的运动表现。
*   **专业数据图表**: 集成 Chart.js，提供配速、心率、海拔的交互式图表，与轨迹播放进度实时联动。
*   **精准地图显示**: 内置 WGS-84 到 GCJ-02 坐标转换算法，完美适配高德地图，解决偏移问题。
*   **沉浸式体验**: 现代化的 UI 设计，支持深色/浅色主题切换，提供流畅的交互体验。
*   **隐私安全**: 所有文件解析均在浏览器本地完成，您的运动数据不会上传至任何服务器。

## 🚀 快速开始

### 环境要求
*   Node.js (v16 或更高版本)
*   npm

### 1. 克隆项目
```bash
git clone https://github.com/your-username/runback.git
cd runback
```

### 2. 安装依赖
```bash
npm install
```

### 3. 配置地图 Key
本项目使用高德地图 JS API。出于安全考虑，API Key 不包含在代码库中。

**本地开发:**
在项目根目录创建一个名为 `.apikey` 的文件，并填入你的高德地图 Web 端 (JSAPI) Key：
```text
AMAP_API_KEY=你的高德地图KEY
```
或者，你可以直接在 URL 中通过参数传递 Key（仅用于临时调试）：
`http://localhost:8787/?key=你的高德地图KEY`

### 4. 启动开发服务器
使用 Cloudflare Wrangler 启动本地开发环境：
```bash
npm start
```
应用通常会在 `http://localhost:8787` 启动。

## 🛠️ 技术栈

*   **核心逻辑**: Vanilla JavaScript (ES Modules)
*   **地图引擎**: [高德地图 JS API 2.0](https://lbs.amap.com/)
*   **图表库**: [Chart.js 4.4](https://www.chartjs.org/)
*   **文件解析**: 自研原生解析器 (FitParser, TcxParser, GpxParser)
*   **开发工具**: [Vite](https://vitejs.dev/) (测试), [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/) (开发与部署)
*   **测试框架**: [Vitest](https://vitest.dev/)

## 📂 项目结构

```
FitPlayer/
├── app.js                 # 核心应用逻辑 (解析器, 播放器, 地图渲染)
├── app.test.js            # 单元测试文件
├── index.html             # 主入口 HTML
├── styles.css             # 全局样式
├── landing-page.css       # 启动页特定样式
├── functions/             # Cloudflare Pages Functions
│   └── api/
│       └── amap-key.js    # 安全获取 API Key 的后端函数
├── assets/                # 静态资源图片
└── wrangler.jsonc         # Cloudflare 部署配置
```

## 🧪 运行测试

本项目使用 Vitest 进行单元测试，主要测试文件解析逻辑。

```bash
npm test
```

## 🚢 部署

本项目配置为使用 Cloudflare Pages 进行部署。

1.  确保你已安装 Wrangler CLI 并登录。
2.  在 Cloudflare Dashboard 中为你的 Pages 项目设置环境变量 `AMAP_API_KEY`。
3.  运行部署命令：
    ```bash
    npx wrangler pages deploy .
    ```

## 📄 许可证

ISC License
