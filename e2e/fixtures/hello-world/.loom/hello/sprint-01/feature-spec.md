# Sprint 01: Hello World CLI

## 功能描述
创建一个简单的 Node.js CLI 工具。运行后输出问候语，支持默认问候和自定义名字问候。

## 用户故事
- 作为用户，我希望运行 `node index.js` 时看到 `Hello, World!`
- 作为用户，我希望运行 `node index.js --name Alice` 时看到 `Hello, Alice!`

## 技术方向
- 纯 Node.js，不使用任何外部依赖
- 使用 process.argv 解析命令行参数
- 包含 package.json

## 交付物
- index.js — 主入口文件
- package.json — 项目配置
