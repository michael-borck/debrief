# Debrief

<!-- BADGES:START -->
[![ai-powered-transcription](https://img.shields.io/badge/-ai--powered--transcription-blue?style=flat-square)](https://github.com/topics/ai-powered-transcription) [![cross-platform](https://img.shields.io/badge/-cross--platform-blue?style=flat-square)](https://github.com/topics/cross-platform) [![desktop-app](https://img.shields.io/badge/-desktop--app-blue?style=flat-square)](https://github.com/topics/desktop-app) [![ffmpeg](https://img.shields.io/badge/-ffmpeg-blue?style=flat-square)](https://github.com/topics/ffmpeg) [![local-processing](https://img.shields.io/badge/-local--processing-blue?style=flat-square)](https://github.com/topics/local-processing) [![natural-language-processing](https://img.shields.io/badge/-natural--language--processing-blue?style=flat-square)](https://github.com/topics/natural-language-processing) [![privacy-first](https://img.shields.io/badge/-privacy--first-blue?style=flat-square)](https://github.com/topics/privacy-first) [![typescript](https://img.shields.io/badge/-typescript-3178c6?style=flat-square)](https://github.com/topics/typescript) [![audio-video-processing](https://img.shields.io/badge/-audio--video--processing-blue?style=flat-square)](https://github.com/topics/audio-video-processing) [![edtech](https://img.shields.io/badge/-edtech-4caf50?style=flat-square)](https://github.com/topics/edtech)
<!-- BADGES:END -->

[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=flat&logo=github)](https://github.com/michael-borck/debrief)
[![Docs](https://img.shields.io/badge/Docs-In--app-blue?style=flat&logo=readthedocs)](https://github.com/michael-borck/debrief/tree/main/docs)
[![Ingest](https://img.shields.io/badge/GitIngest-View-orange?style=flat)](https://gitingest.com/michael-borck/debrief)
[![Deep Wiki](https://img.shields.io/badge/Deep%20Wiki-Explore-green?style=flat)](https://deepwiki.com/michael-borck/debrief)

AI-powered conversation analysis and insight discovery platform with local processing and privacy-first design.


## Features

- **Audio/Video Support**: MP3, WAV, MP4, AVI, MOV, M4A, WebM, OGG, and more
- **Privacy-First**: Transcription and speaker diarisation run entirely on your machine. AI analysis uses your choice of local Ollama or any of OpenAI / Anthropic / Groq / Gemini / OpenRouter / custom — your call.
- **Local Whisper**: Built-in English transcription via `@huggingface/transformers`. No external server required.
- **Local Speaker Diarisation**: pyannote-segmentation-3.0 + wespeaker for real audio-level "who said what". No LLM guessing from text.
- **In-app Documentation**: Rendered with the app's theme, ships with the binary, no internet required.
- **Cross-Platform**: macOS, Windows, Linux. FFmpeg bundled.

## Installation

Download the latest release for your platform from the [Releases](https://github.com/michael-borck/debrief/releases) page.

## Development

### Prerequisites

- Node.js 20+
- npm or yarn
- (Optional) Speaches service running on http://localhost:8000
- (Optional) Ollama service running on http://localhost:11434

### Setup

```bash
# Clone the repository
git clone https://github.com/michael-borck/debrief.git
cd debrief

# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run dist
```

## Release Process

### GitHub Secrets Required

To enable automatic builds when you create a release tag, set up these GitHub secrets:

1. **For macOS Code Signing (Optional)**:
   - `MAC_CERTS`: Base64 encoded .p12 certificate
   - `MAC_CERTS_PASSWORD`: Certificate password
   - `APPLE_ID`: Your Apple ID
   - `APPLE_ID_PASS`: App-specific password
   - `APPLE_TEAM_ID`: Your Apple Developer Team ID

2. **Automatic (Already exists)**:
   - `GITHUB_TOKEN`: Automatically provided by GitHub Actions

### Creating a Release

1. Update version in `package.json`
2. Commit changes: `git commit -am "Bump version to v1.0.0"`
3. Create tag: `git tag v1.0.0`
4. Push tag: `git push origin v1.0.0`
5. GitHub Actions will automatically build for all platforms
6. Edit the draft release on GitHub and publish

### Build Outputs

- **Windows**: `.exe` installer
- **macOS**: `.dmg` installer and `.pkg` for Mac App Store
- **Linux**: `.AppImage` and `.deb` packages

## Architecture

```
Debrief/
├── src/               # React TypeScript source
├── public/            # Electron main process
├── database/          # SQLite schema
└── ffmpeg-binaries/   # Platform-specific FFmpeg
```

## Technologies

- **Frontend**: React + TypeScript
- **Desktop**: Electron
- **Database**: SQLite (better-sqlite3)
- **Styling**: Tailwind CSS
- **Transcription**: Speaches API
- **AI Analysis**: Ollama API
- **Media Processing**: FFmpeg (bundled)

## License

MIT