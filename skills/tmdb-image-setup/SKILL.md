---
name: tmdb-image-setup
description: 自动部署或更新自建 TMDB Image Worker，验证直连图片加载，评估并验证域名服务端的入口优选，交付可填入客户端的地址。用于用户要求 AI 代办部署、图片加速或域名入口优选；不能用本机映射冒充服务端生效。
---

# TMDB 图片部署与优选

直接完成用户授权的操作，交付 `https://用户域名/t/p/` 和简短实测结果。优先完整下载成功率，再比较速度；“最快”只指当前网络、候选入口和测试时段中的结果。

用户目标是服务端配置好，终端只填图片链接即可直连。不能要求安装代理客户端、修改 hosts 或路由器 DNS 来完成本技能的域名优选。普通域名可直连和服务端优选完成是两个状态，分别报告。

## 准备

- 项目：https://github.com/liixing/tmdb-image-worker 。已有 checkout 就复用；只有安装后的技能文件时，将项目克隆到独立目录。先读当前 `wrangler.jsonc`、`package.json`、`worker.mjs`，保留用户改动。
- 复用已有 Cloudflare 登录和部署；用项目固定版本的 Wrangler 执行 `whoami`。未登录时引导用户完成官方登录，不要求把密码或令牌发进聊天。
- 从现有配置确定账号、Worker 和图片域名。多个账号无法确定归属、域名缺失或已有同名服务身份不明时，只询问缺少的信息。示例域名和项目作者的域名均不能充当用户自己的部署目标。
- 用户仅要求测速时不部署。授权部署和优选不包含购买域名、升级套餐、覆盖无关服务或修改全局网络规则。

## 部署与功能验证

1. 复用用户已有 Worker；新建时选择未占用的名称。保留 `cache.enabled: true` 和 `cross_version_cache: true`，免费套餐不要新增 `limits.cpu_ms`。无需 API Key、KV、R2 或图片转码。
2. 用户有同账号托管的域名时，在 `wrangler.jsonc` 的 `routes` 合并 `{ "pattern": "用户图片域名", "custom_domain": true }`。先检查该域名没有指向其他服务，保留无关路由。不用 IP 优选改写 Cloudflare 托管的 Custom Domain 记录。
3. 在项目目录运行 `npm test`、`npm run check:deploy`，通过后执行 `npm run deploy`。保存实际部署地址及版本；部署失败先修复明确错误，不反复重建资源。没有自定义域名时可验证部署产生的 workers.dev 地址，可达性以用户网络实测为准。
4. 根路径应返回 `TMDB image worker OK`；必须再完整下载真实图片，验证 HTTP 状态、图片解码和重复请求的缓存状态。需要协议检查时复用 `npm run smoke -- https://用户图片域名`；该脚本有 20 秒请求总期限且需要访问原站，它的超时不等于 Worker 最终加载失败，慢网络需用下一节无短总时限的方法复核。
5. 保持图片原始尺寸和字节；上游可访问时对同路径比对 SHA-256。不能通过缩图、转码、关闭证书校验或缩短超时来获得更好成绩。

配置语义不明确时查 [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) 和 [Workers Cache](https://developers.cloudflare.com/workers/cache/configuration/)，不猜测 API 参数。

## 服务端接入方案

优先使用 **DNS-only A 记录 → 优选 Cloudflare IP + Worker Route `图片域名/*`**。不需要 SaaS，不需要终端网络配置，也不修改 Worker 回源逻辑。2026-10-06 已在本项目独立子域名及正式域名验证：公开 DNS、正常 HTTPS、31 张 App 图片完整解码均通过；验证时没有 `--resolve` 或本地 IP 映射。

这是实测方案，不是 Cloudflare 对灰云路由的兼容性承诺。[官方 Routes 文档](https://developers.cloudflare.com/workers/configuration/routing/routes/)通常要求 proxied DNS；因此在每个用户账号先用独立子域名验证。若出现证书、1000/1016 或路由错误，检查实际绑定与 DNS，不能仅凭文档或示例宣称成功。

Custom Domain 的托管 DNS 不能直接编辑；橙云 A/CNAME 也不会将用户填写的 IP 原样公开。优选要迁移到普通 Route，不能只修改 Custom Domain 的底层记录。Worker 执行时客户端已经连上边缘，改回源 IP 不会优选客户端入口。

## 在用户网络优选

必须从用户实际使用的网络发起请求。云端 AI 的测速不能代表用户电脑、手机或电视；若无法访问用户网络，可完成部署并提供本地可运行的测速命令，但应明确优选尚未验证，不能编造最快入口。

1. 记录默认解析的基线，再用 `dig +short A 域名` / `dig +short AAAA 域名` 获取真实候选公网地址。排除虚拟 DNS、私网和非 IP 结果。优先比较域名现有地址及用户给出的 Cloudflare 候选，不扫描全部网段。IPv6 仅在当前网络可用时测。
2. 从 App 的已知图片 URL 或用户提供的链接选取少量真实样本：海报、`original` 大图、PNG；使用预告片封面时也覆盖其路径。没有 App 数据时，`smoke.mjs` 中的示例仅能作初步验证，不能宣称已覆盖用户的大图场景。
3. 复用 curl 指定候选地址，按同一组图片交替测各入口 2–3 轮；保存响应头、完整文件及耗时。以下变量必须替换为实际值：

   ```sh
   image_host='用户图片域名'
   image_ip='候选公网IP'
   image_path='/t/p/original/真实文件名.jpg'
   image_output=$(mktemp -d)
   curl --noproxy '*' --resolve "${image_host}:443:${image_ip}" \
     --fail --silent --show-error \
     -D "$image_output/headers.txt" -o "$image_output/image" \
     -w '%{json}\n' "https://${image_host}${image_path}"
   ```

   IPv6 地址在 `image_ip` 中用方括号包围。系统 curl 不支持 `%{json}` 时改用独立字段记录 `http_code`、`remote_ip`、`size_download`、`time_starttransfer`、`time_total`。不在 URL 中加入随机 query，本项目会将其重定向移除。
4. `--noproxy` 无法绕过 VPN、增强模式或路由器代理。核对实际远端 IP 和出口策略；被虚拟 DNS 或透明代理接管时，从现有网络工具的连接记录验证。不能确认实际候选入口的样本标为无效。
5. HTTP 200 之外还要确认 curl 正常收完且图片能完整解码。分别记录成功数/总数、完整下载耗时中位数、最慢值和 HIT/MISS；不要把 Ping、响应头耗时或未收完的正文当作成功。不要将冷缓存与热缓存的速度差直接归因于 IP。
6. 不新增 20 秒之类的整图截止。若测试预算用尽，记录已完成、失败和未完成三类，未完成不能算超时失败，也不能算成功。必要时对未完成样本补测；不要无限重试，也不要靠延长等待宣称加载变快。
7. 先按完整下载成功率排序，再在可比缓存状态下比较整图耗时；结果接近或没有稳定改善时保留默认解析。对胜出候选用少量并发复核，覆盖客户端同时加载多张图的情形。

## 让结果在服务端生效

`curl --resolve` 只用于测候选入口，不是部署结果。优选需要通过受支持且已验证的公开域名入口配置生效；不能交付 IP 字面量 URL、所谓优选 query 参数或绕过证书校验的链接。

按下面步骤落实，不停留在提供候选 IP：

1. 保存目标域名的 DNS、Custom Domain 绑定和路由。先创建空闲的单层测试子域名，确认域名所在 zone 正常且边缘证书覆盖该名称；保留无关服务。
2. 添加 DNS **A** 记录，内容为实测胜出的 Cloudflare IPv4，`proxied: false`（仅 DNS），TTL 300 秒；添加普通 Worker Route `测试域名/*` 指向已有图片 Worker。无需新建 Worker 或改动图片代码。
3. 用公开 DNS/DoH 验证实际 A/AAAA，排除旧 AAAA 绕过所选 IPv4；正常 HTTPS 请求根路径及真实大图，验证证书、HTTP 200、完整解码和缓存。禁止用 `--resolve`、hosts 或代理软件 IP 覆盖作为该步骤的验收。
4. 测试通过后，添加正式 Route `图片域名/*`；若已有同名 Custom Domain，移除该绑定后立即创建正式灰云 A 记录。只操作本次目标域名。更新部署配置，将该域名的 `custom_domain: true` 替换为 `{ "pattern": "图片域名/*", "zone_name": "所属根域名" }`，保留其他 routes。
5. 在用户网络用正常域名复测，确认公开解析、实际远端和完整图片成功率，覆盖海报、原图、PNG 和预告片。去除本任务先前添加的本机 IP 覆盖后再验收；已有代理环境仅用于确认请求确实直连，不作为用户使用要求。
6. 清理测试域名和临时 Route。若正式迁移失败，移除本次冲突的灰云记录并恢复原 Custom Domain 绑定及配置；没有旧绑定时恢复备份。报告验证失败原因，不擅自改用 SaaS 或付费产品。

复用已有 Cloudflare 登录权限：Wrangler OAuth 通常可操作 Worker 路由但未必有 DNS 写权限。DNS API 无权限时使用已登录控制台操作 DNS；不要把权限错误解释成方案不可用，不必为此创建长期令牌。API 参数不明确时核查官方接口；DELETE 可能成功返回空响应体，读取资源状态确认，不能因 JSON 解析失败重复执行。

不能确认公开域名已生效时，报告“部署可用、服务端优选未完成”及具体原因。不能仅凭本机覆盖后测速快就宣称完成，也不能承诺选中的 IP 对所有用户最快。

## 交付

用几行给用户结果，不输出长教程：

- 可复制的图片地址：`https://实际部署域名/t/p/`，填写到客户端 **TMDB → 图片地址**。
- 当前网络下完整成功数/总数及整图耗时；注明公开域名是否已应用并验证服务端优选。未完成时直说，不使用“最快”结论。
- 需要用户参与的剩余步骤，仅在登录、权限、客户端操作或本地网络访问确实缺失时列出。

不改 API 地址。配置客户端仅在用户已要求且存在可用操作方式时执行。不承诺单个候选 IP 对所有地区最快或永不超时。
