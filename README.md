# TMDB Image Worker

自建 TMDB 图片代理，适用于 Cloudflare Workers 免费套餐。流式返回图片，保留原图画质。

让 AI 代办：把下面这句话发给能操作终端的 AI，它会按 [Skill](skills/tmdb-image-setup/SKILL.md) 部署、验证，并通过 DNS + Worker Route 应用优选 IP。

> 读取 https://github.com/liixing/tmdb-image-worker/blob/main/skills/tmdb-image-setup/SKILL.md ，帮我部署图片 Worker，在我的直连网络优选 IP，通过 DNS + Worker Route 在服务端生效，最后给我可直接填入客户端的图片地址和实测结果。

## 1. 部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fliixing%2Ftmdb-image-worker)

1. 点击按钮，登录 Cloudflare，按提示连接 GitHub 并部署。无需 TMDB API Key。
2. 大陆使用建议绑定自己的域名：Worker → **Settings → Domains & Routes → Add → Custom Domain**。域名需托管在同一 Cloudflare 账号。
3. 打开部署地址，看到 `TMDB image worker OK` 即部署成功，再用客户端验证图片加载。

保留仓库的 `wrangler.jsonc` 和 `cache.enabled: true`，不要只复制 JS。后续通过仓库部署时，将自定义域名也写入配置：

```jsonc
"routes": [{ "pattern": "images.example.com", "custom_domain": true }]
```

下文的 `images.example.com` 均替换成你自己的域名。

## 2. 填入客户端

EPlayerX → **设置 → TMDB → 图片地址**，填写：

```text
https://images.example.com/t/p/
```

不要填到 **API 地址**。也支持只填 `https://images.example.com`。

原图请求对应 `/t/p/original/文件名.jpg`，不会压缩或降低清晰度；列表使用客户端请求的尺寸。其他支持自定义 TMDB 图片地址的客户端填写同样的前缀。

## 3. 优选 IP

分两步：**测出合适的 IP，再写入公开 DNS，并用 Worker Route 接管请求**。用户设备只需填写图片域名。

先查询候选 IP：

```sh
dig +short A images.example.com
```

逐个替换下面的候选 IP，用 App 中真实的原图路径测速：

```sh
image_host='images.example.com'
image_ip='替换成候选IP'
image_path='/t/p/original/替换成真实图片文件名.jpg'
curl --noproxy '*' --resolve "${image_host}:443:${image_ip}" \
  --fail --show-error -D - -o image-test.jpg \
  -w '\nHTTP=%{http_code} IP=%{remote_ip} 总耗时=%{time_total}s\n' \
  "https://${image_host}${image_path}"
```

- 用几张海报和大图，各测 2–3 次；确认 HTTP 200，并打开 `image-test.jpg` 检查完整性。
- 记录 `CF-Cache-Status`，首次请求和缓存命中分开比较。选择成功率高、整图耗时低的 IP，不只看 Ping。
- 使用实际直连网络；`--noproxy` 不会绕过 VPN。`198.18.x.x` 等虚拟地址不能作为公网候选 IP。
- 换网络后重测，没有适合所有地区的固定最快 IP。

测好后，在 Cloudflare 配置：

1. 添加 **Route** `images.example.com/*`，选择你的图片 Worker。
2. 如果同名域名已绑定 **Custom Domain**，先移除这个绑定，再在 DNS 添加 **A** 记录：名称 `images`、内容为实测胜出的 Cloudflare IP、代理状态 **仅 DNS（灰云）**。
3. 将 `wrangler.jsonc` 中该域名的 `custom_domain` 配置替换为下面的路由，防止下次部署改回去：

   ```jsonc
   "routes": [{ "pattern": "images.example.com/*", "zone_name": "example.com" }]
   ```

4. 查询公开 DNS，确认返回选定 IP；不用 `--resolve`，正常访问域名并完整下载大图验证。

已有服务先在空闲子域名验证再切换。该方式已在本项目实测通过，无需 SaaS；官方路由文档通常要求代理记录，因此其他账号也必须实际验证 HTTPS 和图片响应。失败时恢复原 Custom Domain 绑定。单个 IP 的速度因运营商、地区和时段而异。

[MIT License](LICENSE)
