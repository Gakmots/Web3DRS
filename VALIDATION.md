# 0.1.3 验证记录

## 本次实现

RPC 发送前通过可信扩展页面向后台请求安装 endpoint 专属 DNR 会话规则。规则设置 initiatorDomains 为当前扩展 ID，精确匹配 HTTPS origin 与路径，只处理 POST / OPTIONS 的 xmlhttprequest；移除来源、Fetch Metadata、Cookie 和 SDK 标识头。查询参数不进入规则。网络请求显式不带 credentials / referrer，且不自动跟随重定向。

失败时关闭请求出口：权限不足、规则编译 / 安装失败、上下文失效，都在 fetch 之前报错。多个 endpoint 的规则并存，并在 worker 恢复时检查已有会话规则。停用导航规则不影响 RPC 头部处理。

## 已通过

- 33 项自动测试，包含来源头与相邻自定义头清理、认证头保留、作用域边界、并发安装、worker 恢复、权限拒绝、规则配额用尽、请求必须等待规则确认、安装失败零发送等回归场景。
- 编译后的浏览器 SNS 模块在无 Node process / Buffer 全局变量的测试环境中通过完整 SDK fixture。扩展运行时消息在此测试中被明确模拟，不是实际网络层验收。
- 原有三条导航规则和一个代表性 endpoint 的头部规则按 Chromium RE2 设置进行编译预算检查；真实 endpoint 在每次安装前还会调用 Chrome isRegexSupported。

## 真实浏览器尝试与未验证内容

运行了 `npm run test:headers`。本机 HTTPS 接收服务器及测试扩展副本成功准备，但 Chrome for Testing 131 在启动时以 SIGTRAP 退出，未到达请求阶段。因此：

- 没有声称服务器已经接收到不含 Origin 的 Chrome 请求；
- 没有用 Node 的默认无 Origin 行为冒充 DNR 已生效；
- 需在能启动 Chromium 的本机运行接收端测试，验证最终发包和正常网页不受影响。

此测试脚本使用临时证书和本机测试服务，仅对测试浏览器启用证书忽略 / 测试主机映射；正式扩展没有关闭 TLS 验证，也不包含证书私钥。

---

以下为历史版本记录：

# 0.1.2 验证记录

版本：0.1.2。Node.js 24、Linux。

## 根据用户截图复现

截图为 `sns.sns` 查询，主机 `api.mainnet.solana.com`，方法 `getAccountInfo`，真实 HTTP 403。此前 0.1.1 的无 Origin 命令行检查不能覆盖浏览器请求来源。

分别向 `api.mainnet.solana.com`、`api.mainnet-beta.solana.com` 和 `solana-rpc.publicnode.com` 发出 `getGenesisHash` 请求：

| RPC | 不带 Origin | 带 chrome-extension Origin |
| --- | --- | --- |
| 官方 mainnet | 200，主网 hash | 403 Access forbidden |
| 官方 mainnet-beta | 200，主网 hash | 403 Access forbidden |
| PublicNode | 200，主网 hash | 200，主网 hash |

使用带同样 Origin 的实际新代码继续执行 PublicNode 主网验证、getAccountInfo、getMultipleAccounts，均 HTTP 200。随后真实查询 `sns.sns`，得到 URL `https://www.sns.id/`：当前持有者验证通过，网站关联认证未通过（rightOfAssociationValidation=3）。这是与 HTTP 403 不同的记录认证问题。

## 已通过

- 28 项自动测试，包括真实格式 SDK 账户、无 NFT、已销毁 NFT、有流通 NFT、HTTP / JSON-RPC 错误、主网及账户读取预检、旧设置迁移、私有 API Key 不被迁移、关联未认证记录只提供手动候选地址等。
- 打包后的浏览器 SNS 模块在无 Node process / Buffer 全局变量的环境中完整解析三类 NFT fixture。
- DNR 三条规则按 Chromium Latin1、2 KiB 预算的 RE2 检查，program size 29 / 96 / 54。
- 实际携带浏览器扩展 Origin 的 PublicNode 探测与 `sns.sns` 查询已完成。不是对未来所有地区 / 网络的可用性保证。

## 仍需本机验证

此环境此前无法启动 Chrome for Testing，因此本次没有宣称完成真实 Chrome 端到端验证。Origin 测试由 Node 发出；实际请求环境的验证由插件新增的「验证并保存」执行。浏览器脚本增加了关联未认证页面的手动确认用例，仍需在可启动 Chromium 的环境运行。

---

以下为 0.1.1 的历史验证记录：

# 0.1.1 验证记录

版本：0.1.1。执行环境：Node.js 24、Linux。

## 已复现的问题

对真实主网域名 `bonfida.sns` 使用默认公共 RPC 执行旧版流程，账户读取 `getAccountInfo` 与 `getMultipleAccounts` 均返回 HTTP 200，但随后的 `getTokenLargestAccounts` 返回 HTTP 429。额外读取对应 SPL mint 证实该账户存在、长度为 82 字节、供应量为 0。

SDK 4.0.1 的高层记录查询仍会请求该 NFT 的持有人，即使 NFT 不存在或已销毁 / 解包。这个高成本方法被单独限流，会使本来正常的域名账户读取整体失败。旧版错误页面又将多种含有 fetch / failed to get 的错误统一归类为 RPC 故障，掩盖具体原因。

## 修复

- 调用高成本持有人查询前，先使用账户读取与官方 SPL Token 的 `unpackMint` 验证 mint。
- mint 不存在或供应量为 0 时，向 SDK 返回无流通 NFT 的结果，继续使用注册表持有者验证记录。
- 有流通 NFT 时仍查询并验证实际 token 持有人。查询报错、结果为空、token 账户缺失或 mint / amount 不匹配时终止解析，不静默回退为注册表持有者。
- 将网络故障、HTTP 状态、JSON-RPC 方法错误、组件加载、域名不存在和网站记录无效分别显示，并提供不含 API Key / 私有路径的错误详情。

## 已通过

- `npm run build`：生成 0.1.1 完整编译产物与第三方许可证。
- `npm test`：22 个测试全部通过。包含原有导航与目标校验，以及无 mint、供应量 0、有流通 NFT、持有人方法限流、JSON-RPC -32602、token 账户缺失、认证失败、无效响应、组件加载错误和诊断脱敏的回归用例。
- `npm run test:bundle`：直接载入编译后的浏览器 SNS 分块，移除 Node 的 `process` 和 `Buffer` 全局变量，验证三类 NFT 状态下的完整 SDK 解析。使用协议格式 RPC fixture，不是实时主网成功声明。
- 三条原有导航规则仍通过按 Chromium 选项设置的 RE2 编译检查，program size 分别为 29 / 96 / 54。
- 对同一 `bonfida.sns` 的修复后实时主网探测：所有实际发出的 RPC 请求均 HTTP 200，不再调用 `getTokenLargestAccounts`。流程正常完成，并明确返回该域名没有本插件支持的 V2 网站记录。**此结果仅证明已消除该已复现故障，不是成功打开真实 SNS 网站的声明。**

## 浏览器端验证限制

此前在本执行环境中尝试启动 Chrome for Testing 时，进程初始化以 SIGTRAP 退出。本次未重复该无效尝试，也没有宣称完成 Chrome 浏览器端实测。真实浏览器集成脚本仍在 `scripts/browser-test.mjs`。

请按 README 更新步骤完整替换编译产物、重新加载扩展并关闭旧解析页。若同一域名仍失败，可提供该域名与错误页展开的「错误详情」，继续排查实际 RPC、权限、记录版本或打包环境。
