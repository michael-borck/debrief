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
- **Local Whisper**: faster-whisper running inside a bundled Python sidecar. No external server required, no cloud upload.
- **Local Speaker Diarisation**: pyannote.audio 3.1 in the same sidecar. Model weights bundled into the installer (MIT / CC-BY-4.0), no HuggingFace token needed at runtime.
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

### Local pre-tag smoke test (recommended)

**Do this before every release tag.** `npm start` only exercises the dev runtime; it doesn't catch hardened-runtime, code-signing, or sidecar-spawn-from-packaged-app bugs (we shipped three of those in a row — v1.8.0/.1/.2 — for not doing this).

```bash
# Builds the .app under release/mac-arm64/, signed with hardened
# runtime if a Developer ID cert is in your Keychain. Skips dmg
# packaging and notarization (NOTARIZE_APPLE_* not set locally).
npm run pack

# Launch the packed .app — same hardened-runtime conditions as the
# eventual dmg, but no notarization round-trip.
open release/mac-arm64/Debrief.app

# Watch the sidecar logs while it boots:
tail -f ~/Library/Application\ Support/debrief/logs/setup.log
```

If the packed app starts cleanly and you can transcribe a short clip end-to-end, then you can tag with confidence. If it fails, you'll see the actual subprocess error in `setup.log` (a real traceback, not just `exit 1`).

If `npm start` was your only test, **delete the dev userData dir before testing the packed app** to make sure the packed app's first-launch path actually runs:

```bash
rm -rf ~/Library/Application\ Support/debrief/venv
```

(`audio-scribe.db` stays — only the Python env gets rebuilt, ~3-10 min one-time.)

### Creating a Release

1. Do the local pre-tag smoke test above.
2. Update version in `package.json`
3. Commit changes: `git commit -am "Bump version to v1.0.0"`
4. Create tag: `git tag v1.0.0`
5. Push tag: `git push origin v1.0.0`
6. GitHub Actions will automatically build for all platforms
7. Edit the draft release on GitHub and publish

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