# 小伯白桌宠 · desktop-pet-xbb

Windows 桌宠工程：Electron + WebGL2 二维立绘网格，角色为《玉响未来》的小伯白。

本仓库只管理源码、测试和脱敏的使用说明。角色图片、PSD、游戏识别模板、运行数据、密钥与二进制不上传；单独克隆不能直接显示完整桌宠。

## 当前入口

当前正式代码位于根目录、`src/`、`shared/`；启动链为 `launch.cjs → product-main.cjs → desktop-main.cjs → shell.cjs`。

- 自然待机、长发跟随、左右转头、表情及摸头/拉手/裙摆互动。
- Ctrl＋拖动移动，Ctrl＋滚轮缩放，Ctrl＋Shift＋双击隐藏；功能栏可收起。
- 人物与反馈气泡使用一致的置顶级别；独立聊天与模型设置窗口。
- 右键或托盘的“卡丘计时模式”：自动识别卡牌触发，使用本地定时气泡。

`puppet/` 保留早期基线供源码追溯，不是当前启动入口。`docs/` 中的初始核对记录属于历史基线。

## 本地运行

1. 自行准备有权使用的角色素材，放在根目录 `assets/`，包括配套的 `manifest.json`、网格 JSON、贴图；托盘图标为 `shared/tray.png`。历史素材说明见 [local-assets.md](docs/local-assets.md)，其旧 `puppet/` 路径不能直接代替当前素材目录。
2. 自行准备 Electron。`启动小伯白.cmd` 使用 `%USERPROFILE%/.dsh/electron/electron.exe`；也可用自己的 Electron 可执行文件启动根目录 `launch.cjs`。
3. 当前正常运行数据位于 `%APPDATA%/BaijieDesktopV1`，不自动迁移早期聊天和模型设置。新克隆源码不是运行数据隔离环境。

## 卡丘计时模式

模式启动时默认关闭，需右键启用。喵喵赐福按15秒冷却，只在触发后第5秒提醒一次；不提醒开始、结束或30秒效果。笔记按40秒冷却，在开始、剩10秒、结束时提醒。还可选择终焉、信标、分析仪，或从菜单手动开始/重置、清空本局。

F8 按一次自动打开聊天并发送“喵”，不循环发送；以识别到游戏反馈作为计时触发，发送成功回调与冷却计时分开。发送后的额外气泡接口已预留，文案为空。游戏权限较高时，可在菜单授权独立辅助进程；桌宠本身不用提权。

辅助程序由 `kaqiu/worker.py` 构建。需自行提供原计时器的 `config.default.json`、`templates/` 和 `templates_1610/`，放入 `kaqiu/assets/`。图片与原程序不随仓库分发。构建环境需 Python、numpy、Pillow、PyInstaller；本地验证版本为 Python 3.13.2、numpy 2.3.0、Pillow 12.3.0、PyInstaller 6.14.0。安装这些依赖后执行：

    powershell -NoProfile -File kaqiu/build.ps1

输出 `kaqiu/bin/baijie-kaqiu/baijie-kaqiu.exe`，由桌宠管理生命周期，无需另开计时器。若在低完整性开发沙箱构建，应检查交付 EXE 的完整性标签；低完整性进程不能向正常桌宠管道写入，不应因此放宽管道权限。

实际游戏模板命中和 F8 输入仍需现场验证。原2560×1600配置没有喵喵/胜利模板；F8流程沿用聊天框关闭的前提，已打开聊天框时尚未验证。相同聊天行完全替换但行数不变时，当前识别存在局限。

## 测试

当前气泡、计时和置顶的无素材回归：

    node --test tests/source-only-policy.test.cjs tests/kaqiu.test.cjs tests/feedback-shell.test.cjs tests/feedback-topmost.test.cjs

原基线的无素材 Node 回归保留原命令：

    node tools/test.cjs

其他当前 `tests/*.test.cjs` 包含本地贴图、网格与历史对照依赖，不能把通配执行当成公开克隆的默认测试入口。部分历史入口测试桩尚未适配当前窗口接口，未声明全部历史测试通过。Python识别测试 `python -B -m unittest discover -s kaqiu -p test_worker.py` 需要上述本地计时模板。自动检查不代表真实游戏、GPU或人物观感验收。

测试不应读取真实聊天/模型凭据。不要批量执行历史 Electron 验证脚本，也不要直接运行烘焙工具覆盖本地素材。

## 素材与授权边界

项目名和角色归属仅用于说明对象。仓库不附带角色或游戏素材的再分发授权，也不代表原作品权利人认可；没有为第三方作品添加开源许可证。
