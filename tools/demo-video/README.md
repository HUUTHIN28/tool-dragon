# Demo Video Tool

Tool nay giup Codex tao video demo san pham theo luong thuc dung:

- Lap plan demo thanh JSON co the sua tay.
- Mo browser bang Playwright va thao tac theo plan.
- Quay video browser ra `.webm`.
- Tao voiceover script va subtitle `.srt`.
- Ghep audio/subtitle/video bang `ffmpeg` ra file cuoi.

Mac dinh tool khong dung dich vu tra phi. Neu muon giong doc tu nhien, dung provider `openai`
voi `OPENAI_API_KEY`, hoac truyen san file audio da thu am.

## Cai dependency cua tool

Chay mot lan de cai Playwright, Chromium va ffmpeg-static vao chinh plugin:

```bash
demo-video install-deps
```

Sau do kiem tra:

```bash
demo-video check --root /path/to/project
```

## Cai voiceover mien phi de test

Neu muon test long tieng mien phi, khong can API key, cai Edge TTS vao trong plugin:

```bash
demo-video install-free-tts
```

Sau do tao voiceover:

```bash
demo-video voiceover \
  --root /path/to/project \
  --plan demo-video-output/demo-plan.json \
  --recording-manifest demo-video-output/recording/recording.json \
  --provider edge \
  --voice vi-VN-HoaiMyNeural
```

Provider `edge` can mang internet, nhung khong can API key. Day la lua chon de test nhanh;
neu can chat luong thuong mai on dinh hon thi dung `openai` hoac file thu am san.

Tuy chon de tao audio local:

```bash
espeak-ng --version
```

## Kiem tra may

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs check --root /path/to/project
```

## Chay nhanh

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs make \
  --root /path/to/project \
  --url http://127.0.0.1:3000 \
  --goal "Demo chatbot tu van san pham cho khach hang" \
  --message "Xin chao, chatbot co the ho tro gi cho khach hang moi?" \
  --message "Hay tu van mot goi san pham phu hop cho doanh nghiep nho." \
  --out demo-khach-hang.mp4
```

## Luong co the sua plan

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs plan \
  --root /path/to/project \
  --url http://127.0.0.1:3000 \
  --goal "Demo chatbot cho khach hang B2B" \
  --out demo-video-output/demo-plan.json
```

Sua selector trong `demo-plan.json` neu app can selector rieng, roi quay:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs record \
  --root /path/to/project \
  --plan demo-video-output/demo-plan.json \
  --headed
```

Tao script/subtitle voiceover:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs voiceover \
  --root /path/to/project \
  --plan demo-video-output/demo-plan.json \
  --recording-manifest demo-video-output/recording/recording.json
```

Neu co audio thu am san:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs export \
  --recording-manifest demo-video-output/recording/recording.json \
  --voiceover-manifest demo-video-output/voiceover/voiceover.json \
  --audio-file /path/to/voiceover.mp3 \
  --out demo-final.mp4
```

## OpenAI TTS tuy chon

```bash
OPENAI_API_KEY=... \
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs voiceover \
  --plan demo-video-output/demo-plan.json \
  --recording-manifest demo-video-output/recording/recording.json \
  --provider openai \
  --voice alloy
```

Co the doi model bang `--model` hoac env `OPENAI_TTS_MODEL`.
