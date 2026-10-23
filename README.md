<p align="center">
  <img src="src/assets/logo.svg" alt="RT0Wisper" width="120" />
</p>

<h1 align="center">RT0Wisper</h1>

<p align="center">
  Hold a key, speak, and get clean text in any app.<br/>
  A small, cheap Wispr Flow alternative for Windows.
</p>

---

## How it works

1. Hold the hotkey (Right Ctrl by default) and speak.
2. Release the key.
3. **Mistral Voxtral 3** turns your speech into text.
4. **OpenAI Luna** cleans the text: it removes filler words and fixes grammar and punctuation. It runs on your ChatGPT plan, so it needs no OpenAI API key.
5. The clean text is pasted where your cursor is.

If the ChatGPT plan fails, cleanup falls back to **Mistral Ministral 8B**.

In my tests, a 14-second clip took about 0.9 s for speech-to-text and about 3 s for cleanup.

## Setup

The first screen asks for two things only:

- A **Mistral API key**. Create one in [Mistral admin](https://admin.mistral.ai/organization/api-keys). The free plan works.
- **Sign in with ChatGPT**, for cleanup on your plan.

There are no other providers or models to choose.

## Cost

- Voxtral Mini Transcribe 3: about $0.0035 per minute of audio.
- Luna cleanup: included in your ChatGPT plan.

## Run from source

Needs Node.js 24 and pnpm.

```bash
pnpm install
pnpm dev
```

You can also set `MISTRAL_API_KEY` in your environment before you start the app.

## Voice assistant

Select some text, hold the hotkey, and say "Hey Wisper, make this more formal". The selected text is replaced with the result. You can change the name in Settings → Language Models → Voice Assistant.

## Limits

- Meeting notes are off: Mistral Voxtral has no streaming model in this app.

## Credits

RT0Wisper is a fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) (MIT License). Thank you to the OpenWhispr team. See [LICENSE](LICENSE).

The "Sign in with ChatGPT" flow is based on [OpenCode](https://github.com/anomalyco/opencode) (MIT License).
