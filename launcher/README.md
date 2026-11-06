# 单文件唬牌启动器

需要 Rust MSVC 工具链及 Windows SDK。编译前在 resources/bin 放入 Node.js 的 node.exe 和 cloudflared.exe（可从本项目之前的完整 Release 包中取得，并保留 resources/licenses）。

进入 launcher/src-tauri 执行：

    cargo build --release --features tauri/custom-protocol

构建脚本把整个 resources 目录嵌入 EXE。运行时自动释放到应用数据目录 runtime 下按资源内容区分的子目录，检查并补齐缺失或损坏文件。生成的 hupai.exe 可以独立移动和运行，不需要旁边的 resources 文件夹。首次启动需要写入约 145 MB 的运行资源。
