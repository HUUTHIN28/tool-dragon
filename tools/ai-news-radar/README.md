# AI News Radar Tool

Tool nay tao email digest cho:

- Tin tuc va bai blog moi tu cac trang AI lon.
- Thao luan moi tren Reddit ve AI/AI agents.
- Video AI moi tren cac kenh YouTube da cau hinh.
- Video AI moi theo YouTube Search API neu ban bat tuy chon nay.

Mac dinh tool lay noi dung trong 24h gan nhat, dedupe bang state file de khong gui lai
cung mot link trong cac lan chay sau.

## Chay thu

```bash
cd /home/thinnh2/.understand-anything/tools/ai-news-radar
node ai-news-radar.mjs --config config.example.json --dry-run
```

Neu may hien tai chan network, lenh dry-run se bao warning cho cac feed khong fetch duoc.

## Cau hinh email SMTP

Tool doc email SMTP tu bien moi truong, vi vay khong can ghi password vao file JSON.
Vi du voi Gmail app password:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=465
export SMTP_SECURE=true
export SMTP_USER=your-email@gmail.com
export SMTP_PASS='your gmail app password'
```

Tao file cau hinh rieng tu `config.example.json`, sua:

- `email.from`: dia chi gui.
- `email.to`: email nhan digest cua ban.
- `newsFeeds`: cac trang AI lon muon theo doi.
- `siteMaps`: cac trang AI lon khong co RSS cong khai nhung co sitemap/lastmod.
- `jsonSources`: API JSON co cau truc rieng, hien dung cho Hugging Face Daily Papers.
- `redditFeeds`: subreddit hoac Reddit search RSS muon theo doi.
- `youtubeFeeds`: cac kenh video muon theo doi.
- `report.maxItems`: gioi han tong so item trong mot email digest.
- `report.maxPerSource`: gioi han moi nguon de OpenAI/Anthropic/Claude khong bi nguon khac lan het digest.
- `report.requireKeyword`: neu `true`, moi item phai co keyword AI trong title hoac summary.
- `translation`: bat title song ngu. Mac dinh `config.local.json` dung `provider: "auto"`:
  neu co `OPENAI_API_KEY` thi dung OpenAI, neu khong thi dung MyMemory public API mien phi.

Chay gui email:

```bash
node ai-news-radar.mjs --config config.local.json
```

## Cap nhat lien tuc

Chay process dai han, moi 60 phut kiem tra mot lan:

```bash
node ai-news-radar.mjs --config config.local.json --watch --interval-minutes 60
```

Hoac dung cron de chay hang ngay luc 08:00:

```cron
0 8 * * * cd /home/thinnh2/.understand-anything/tools/ai-news-radar && /usr/bin/node ai-news-radar.mjs --config config.local.json >> ai-news-radar.log 2>&1
```

Neu muon moi gio gui item moi, dung:

```cron
0 * * * * cd /home/thinnh2/.understand-anything/tools/ai-news-radar && /usr/bin/node ai-news-radar.mjs --config config.local.json >> ai-news-radar.log 2>&1
```

## Dieu khien bang Telegram

Tool co kem Telegram bot long polling. Ban nhan `tin tức` hoac `/news`, bot se chay
`ai-news-radar.mjs --config config.local.json` va gui email digest.

Tao bot:

1. Mo Telegram, nhan `@BotFather`.
2. Gui `/newbot`.
3. Dat ten bot va username.
4. Copy token BotFather dua cho ban.

Chay bot lan dau de lay chat ID:

```bash
cd /home/thinnh2/.understand-anything/tools/ai-news-radar
export TELEGRAM_BOT_TOKEN='token tu BotFather'
node telegram-bot.mjs --config config.local.json
```

Mo bot tren Telegram va nhan:

```text
/start
```

Bot se tra ve `Chat ID`. Sau do dung chat ID do de cho phep chay lenh:

```bash
export TELEGRAM_ALLOWED_CHAT_IDS='chat_id_cua_ban'
```

Chay bot that:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=465
export SMTP_SECURE=true
export SMTP_USER=huuthin30@gmail.com
export SMTP_PASS='gmail app password'
export TELEGRAM_BOT_TOKEN='token tu BotFather'
export TELEGRAM_ALLOWED_CHAT_IDS='chat_id_cua_ban'

node telegram-bot.mjs --config config.local.json
```

Lenh Telegram:

- `tin tức`: gui email tin moi trong 24h.
- `tin tuc`: nhu tren, khong dau cung duoc.
- `/news`: nhu tren.
- `tin tức 48`: gui email tin moi trong 48h.
- `tin tức 48 gửi lại`: gui lai ca item da tung gui trong 48h.

De bot chay nen khi dong terminal, dung `nohup`:

```bash
nohup node telegram-bot.mjs --config config.local.json >> telegram-bot.log 2>&1 &
```

## YouTube Search API

Khong co API key, tool van doc duoc YouTube RSS theo kenh trong `youtubeFeeds`.
Neu muon quet video moi theo query nhu "AI agents" hoac "agentic AI", bat:

```json
"youtubeSearch": {
  "enabled": true,
  "apiKeyEnv": "YOUTUBE_API_KEY",
  "maxResultsPerQuery": 5,
  "queries": ["AI agents", "agentic AI", "OpenAI agent"]
}
```

Sau do set:

```bash
export YOUTUBE_API_KEY='your youtube data api key'
```

## Title song ngu

Trong `config.local.json`, `translation.enabled` dang bat. Email se hien title goc tieng Anh
va title tieng Viet ben duoi tung item.

Khong can key rieng neu chap nhan dung MyMemory public API mien phi. Nguon nay co gioi han
rate/quota va chat luong dich o muc kha. Neu muon dich on dinh hon, set:

```bash
export OPENAI_API_KEY='your openai key'
```

Va tool se tu dung OpenAI thay cho provider mien phi.

## Luu y nguon tin

RSS URL cua mot so website co the thay doi. Khi mot feed loi, email/dry-run se hien
warning nhung cac feed khac van tiep tuc. Ban co the xoa feed loi hoac thay URL moi
trong file config.

Voi cac feed tin tuc rong nhu VentureBeat, dat `"requireKeyword": true` de chi giu item
co keyword AI/agent trong title hoac summary.

Voi cac trang khong co RSS nhu Anthropic hoac mot so blog cong ty, dung `siteMaps`.
Tool se doc `lastmod` trong sitemap va loc URL theo `include`, vi du `"/news/"`.

Da them san nhieu nguon AI/news/research: VentureBeat AI, MIT Technology Review AI,
TechCrunch AI, The Verge AI, arXiv cs.AI/cs.CL, Ars Technica AI, Wired AI,
Artificial Intelligence News, The Batch, Import AI, AI Weekly, Hugging Face Blog,
Hugging Face Daily Papers, Analytics Insight, Synced Review, Engadget AI va The Neuron.

Mot so nguon newsletter khong co RSS cong khai hoac bi Cloudflare challenge trong CLI
nhu AI Magazine, TLDR AI, The Rundown AI va Techpresso. Nen hien tai chung khong duoc
bat mac dinh de tranh email nao cung co warning gia.

Reddit cung duoc doc bang RSS. Vi du:

```json
{
  "name": "Reddit search: AI agents",
  "url": "https://www.reddit.com/search.rss?q=%22AI%20agents%22&sort=new&t=day",
  "timeoutMs": 8000
}
```

Neu Reddit bi timeout trong network hien tai, cac nguon khac van chay tiep va email se
ghi warning cho tung Reddit feed bi loi.
