# Ollama + DeepSeek-R1 Setup Guide

This guide explains how to set up Ollama with DeepSeek-R1:8b as the AI provider for Schema.ai, replacing Groq/Gemini with a local, unlimited model.

## Why Ollama + DeepSeek-R1?

✅ **No API Keys Required** - Runs completely locally  
✅ **No Token Limits** - Unlimited queries  
✅ **No Rate Limits** - Always available  
✅ **Consistent Responses** - No API outages or quota issues  
✅ **Privacy** - Your data never leaves your machine  
✅ **Fast** - DeepSeek-R1:8b is optimized for speed  

## Installation

### 1. Install Ollama

**Windows:**
Download and install from: https://ollama.com/download/windows

**macOS:**
```bash
brew install ollama
```

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull DeepSeek-R1:8b Model

Once Ollama is installed, pull the DeepSeek-R1:8b model:

```bash
ollama pull deepseek-r1:8b
```

This will download ~4.7GB of model data. The download only happens once.

### 3. Start Ollama Service

**Automatic Start (Recommended):**
Ollama starts automatically on system boot after installation.

**Manual Start:**
```bash
ollama serve
```

You should see: `Ollama is running on http://localhost:11434`

### 4. Verify Installation

Test that DeepSeek is working:

```bash
ollama run deepseek-r1:8b "What is 2+2?"
```

You should get a response. Press `Ctrl+D` or type `/bye` to exit.

## Configuration

### Local Development

No configuration needed! Schema.ai will automatically use Ollama if it's running.

### Vercel Deployment

For production deployments on Vercel, you have two options:

#### Option A: Keep Ollama for Local, Use Groq for Production

Set these environment variables in Vercel:

```bash
USE_OLLAMA=false
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

#### Option B: Expose Ollama via Tunnel (Advanced)

You can expose your local Ollama to Vercel using ngrok or similar:

```bash
ngrok http 11434
```

Then set in Vercel:
```bash
OLLAMA_BASE_URL=https://your-ngrok-url.ngrok.io
OLLAMA_MODEL=deepseek-r1:8b
USE_OLLAMA=true
```

⚠️ **Security Warning:** Only do this if you understand the security implications!

## Environment Variables

All Ollama environment variables are optional with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_OLLAMA` | `true` | Enable/disable Ollama (set to `false` to use Groq/Gemini) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `deepseek-r1:8b` | Model to use |

## Usage

Once Ollama is running with DeepSeek-R1, Schema.ai will automatically use it for:

✅ **Chat queries** - All data analysis questions  
✅ **Data cleaning** - AI-powered data cleaning  
✅ **Google Sheets plugin** - Formula generation and analysis  
✅ **Excel plugin** - All spreadsheet operations  

The system will automatically fall back to Groq/Gemini if Ollama is unavailable.

## Provider Priority

Schema.ai tries providers in this order:

1. **Ollama** (if running) - Local, unlimited
2. **Groq** (if API key set) - Fast, free tier
3. **Gemini** (if API key set) - Backup option

## Troubleshooting

### "Ollama not running" Error

**Check if Ollama is running:**
```bash
curl http://localhost:11434/api/tags
```

**Start Ollama:**
```bash
ollama serve
```

### "Model not found" Error

**List available models:**
```bash
ollama list
```

**Pull DeepSeek-R1:**
```bash
ollama pull deepseek-r1:8b
```

### Slow First Response

The first query after starting Ollama loads the model into memory and may take 10-30 seconds. Subsequent queries are much faster (1-3 seconds).

### Out of Memory

DeepSeek-R1:8b requires ~8GB RAM. If you have less:

**Try the 1.5b version:**
```bash
ollama pull deepseek-r1:1.5b
```

Update `.env.local`:
```bash
OLLAMA_MODEL=deepseek-r1:1.5b
```

### Port Already in Use

If port 11434 is taken:

```bash
OLLAMA_HOST=0.0.0.0:11435 ollama serve
```

Update `.env.local`:
```bash
OLLAMA_BASE_URL=http://localhost:11435
```

## Performance Tips

### 1. Keep Ollama Running
Don't stop the Ollama service. Keeping it running means the model stays in memory for fast responses.

### 2. Use GPU Acceleration
If you have an NVIDIA GPU, Ollama will automatically use it for 10-20x faster inference.

### 3. Preload the Model
Preload DeepSeek to avoid first-query delay:
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "deepseek-r1:8b",
  "prompt": "Hello",
  "stream": false
}'
```

## Alternative Models

You can use other Ollama models by changing the `OLLAMA_MODEL` variable:

**Smaller/Faster:**
```bash
OLLAMA_MODEL=deepseek-r1:1.5b
```

**Larger/Better:**
```bash
OLLAMA_MODEL=deepseek-r1:14b
```

**Other Models:**
```bash
ollama pull llama3.1:8b
OLLAMA_MODEL=llama3.1:8b
```

See all models at: https://ollama.com/library

## Comparison

| Provider | Speed | Cost | Token Limit | Setup |
|----------|-------|------|-------------|-------|
| **Ollama + DeepSeek** | Fast | Free | Unlimited | Install once |
| Groq | Very Fast | Free tier | 30 req/min | API key |
| Gemini | Medium | Free tier | Limited | API key |

## Support

For Ollama issues: https://github.com/ollama/ollama/issues  
For DeepSeek questions: https://github.com/deepseek-ai/DeepSeek-R1

## Next Steps

1. ✅ Install Ollama
2. ✅ Pull DeepSeek-R1:8b
3. ✅ Test with `ollama run deepseek-r1:8b`
4. ✅ Run your Schema.ai app
5. 🎉 Enjoy unlimited AI queries!
