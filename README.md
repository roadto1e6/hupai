# 唬牌

支持 2–6 人的多人诈唬卡牌游戏，包含响应式网页、房间语音和 Windows Tauri 启动器。相同类型的手牌叠放显示。

## 下载运行

在 [Releases](https://github.com/roadto1e6/hupai/releases) 下载完整包，全部解压后运行 `唬牌.exe`。保留同目录的 `resources` 文件夹。启动器使用 Cloudflare Quick Tunnel 生成临时 HTTPS 邀请地址，关闭服务后链接失效。

## 从源码启动

安装 Node.js 22 或更新版本，然后执行：

```sh
npm start
```

浏览器打开 http://localhost:8787 。不需要安装 npm 依赖。运行 `npm test` 检查游戏规则、房间接口和启动器服务。

## 代码目录

- `resources/game/engine.js`：规则引擎。
- `resources/game/server.js`：房间服务、身份校验、存档和语音信令。
- `resources/game/public/`：网页、语音模块和美术资源。
- `resources/supervisor.cjs`：Quick Tunnel 生命周期管理。
- `resources/public-health.cjs`：公网健康检查与备用 DNS 解析。
- `launcher/`：完整 Tauri 启动器源码，包括界面、图标和 Rust 原生代码；编译方式见其 README。
- `tests/`：自动测试。

EXE 和 Node/cloudflared 运行时随 Release 提供，不纳入 Git 源码历史。第三方运行时许可证在 `resources/licenses/`。

## 游戏规则

共 48 张牌，A、2、3、4、5、JOKER 各 8 张。每轮固定宣称点数，每手出 1–4 张；当前行动者可以出牌、质疑最新一手或不要。不要后退出本轮。质疑只揭最新一手，输家收整堆。JOKER 万能，但不替其他假牌免责。最后一手经判真或其余有效玩家全部放行后获胜，一局只有一个赢家。

完整操作和规则见 [使用说明](使用说明.md)。

## 语音与验证范围

麦克风默认关闭，由玩家主动加入语音。本机或 HTTPS 页面可用。六个独立浏览器会话的模拟麦克风收发、静音和重连已验证；真实异地设备和移动浏览器语音尚未完整实测。受限网络可能需要自行配置 TURN 中继。Quick Tunnel 已通过公网健康检查，临时地址不提供固定域名或可用性保证。
