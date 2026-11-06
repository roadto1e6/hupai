# 唬牌启动器源码

需要 Rust MSVC 工具链及 Windows SDK。进入 src-tauri，执行：

    cargo build --release --features tauri/custom-protocol

将 target/release/hupai.exe 复制为游戏目录中的 唬牌.exe，与 resources 文件夹放在一起运行。此源码只构建启动器，游戏及 Node/cloudflared 运行时由完整便携版提供。界面文件在 ui/，图标在 src-tauri/icons/。
