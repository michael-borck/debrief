const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, safeStorage } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
// execFile (not exec) runs the binary directly without a shell, so file paths
// containing spaces or shell metacharacters can't inject commands. maxBuffer is
// raised because the duration-probe calls read ffmpeg's full stderr log.
const execFileAsync = promisify(execFile);
const FFMPEG_MAX_BUFFER = 1024 * 1024 * 16;
const aiProviders = require('./ai-providers');
const URLS = require('./electron-urls');
const { MainVectorStore } = require('./electron/vector-store');
const { SidecarManager } = require('./electron/sidecar-manager');
const sidecarClient = require('./electron/sidecar-client');

// Isolate dev's userData dir from packaged so they don't share a single
// `~/Library/Application Support/debrief/` and poison each other's venv
// (the venv's pyvenv.cfg pins the original Python path; if dev created it,
// the packaged app's signed Python can't take over, and vice versa).
//
// Must run BEFORE anything calls app.getPath('userData'). app.setName()
// overrides app.getName(), which is what userData resolution uses.
if (process.env.NODE_ENV === 'development' && !app.isPackaged) {
  app.setName('debrief-dev');
}

const sidecar = new SidecarManager();
sidecarClient.init({ sidecar });

// ============================================
// Custom protocol for streaming local audio/video files
// ============================================
//
// The renderer can't use file:// URLs in an <audio>/<video> element due
// to CSP, and reading the whole file via IPC → Blob is too slow for big
// media files. We register a custom 'safe-file://' scheme that Electron
// streams directly from disk with native HTTP semantics (range requests,
// content-type), so <audio src="safe-file:///abs/path.mp4"> just works
// and the browser can seek without pre-loading.

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'safe-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

// Whisper transcription + diarisation now run inside the sidecar (see
// public/electron/sidecar-client.js); the in-process @huggingface/transformers
// pipeline and JS-side diariser have been removed.

let mainWindow;
let db;

// Disable electron-reload for now as it may cause issues
// if (process.env.NODE_ENV === 'development') {
//   require('electron-reload')(__dirname, {
//     electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
//     hardResetMethod: 'exit'
//   });
// }

// One-time migration: rename the userData dir from any legacy product name
// to the current one. legacyNames lists every previous product slug; path
// literals are built with string concatenation so the bulk-rename script
// doesn't rewrite them away when we drop the next product name in.
//
// Electron pre-creates the new userData dir with empty Cache/Cookies before
// this runs, so `readdirSync(newDir).length > 0` is always true and a naive
// check skips migration even on a clean install. We detect "real" data by
// looking for our app's DB file — if it's not there, the new dir is just
// Electron's scaffolding and is safe to clobber.
// The DB filename also doubles as the "this is a real userData dir" marker
// during legacy-dir migration. Used by hasRealAppData, initDatabase, and
// change-database-location — single source of truth so a future rename
// can't desync one site from another.
const DB_FILENAME = 'audio-scribe.db';
const APP_DATA_MARKER = DB_FILENAME;

function hasRealAppData(dir) {
  try {
    return fs.existsSync(path.join(dir, APP_DATA_MARKER));
  } catch {
    return false;
  }
}

function rmRecursive(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[migration] could not remove ${target}:`, err.message);
  }
}

function migrateLegacyUserDataDir() {
  const newDir = app.getPath('userData');
  const home = require('os').homedir();
  const legacyNames = ['deep' + '-talk', 'deep' + '-debrief'];
  const platformBase = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support')
    : process.platform === 'win32'
      ? (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));

  for (const legacy of legacyNames) {
    const oldDir = path.join(platformBase, legacy);
    if (oldDir === newDir) continue;
    if (!fs.existsSync(oldDir)) continue;

    const newHasData = hasRealAppData(newDir);
    const oldHasData = hasRealAppData(oldDir);

    // Case A: new dir has the real DB → it's the active one. Old dir is
    // either stale or empty Electron scaffolding. Either way, remove it.
    if (newHasData) {
      console.log(`[migration] active data dir is ${newDir}; cleaning up stale ${oldDir}`);
      rmRecursive(oldDir);
      continue;
    }

    // Case B: old dir has the DB, new dir is just Electron's scaffolding.
    // Wipe the new dir's empty scaffolding and rename the old dir onto it.
    if (oldHasData) {
      rmRecursive(newDir);
      try {
        fs.renameSync(oldDir, newDir);
        console.log(`[migration] renamed ${oldDir} -> ${newDir}`);
        return;
      } catch (err) {
        console.error(`[migration] rename ${oldDir} -> ${newDir} failed:`, err);
      }
      continue;
    }

    // Case C: neither has real data. Old dir is just Electron junk from a
    // previous launch under the legacy name. Safe to remove.
    console.log(`[migration] removing empty legacy dir ${oldDir}`);
    rmRecursive(oldDir);
  }
}

const os = require('os');

// Transcode any input audio to a canonical 16 kHz mono WAV in the OS temp
// dir. pyannote's torchcodec backend chokes on MP3 frame-boundary precision
// (a 10s chunk decodes to ~439,895 samples instead of the expected 441,000),
// so we normalise inputs before POSTing to /analyse. ffmpeg-static is the
// same binary we use for media probing. Caller owns deletion of the temp
// file.
async function transcodeToWav16kMono(inputPath) {
  const ffmpegPath = getFFmpegPath();
  const tmp = path.join(os.tmpdir(), `debrief-${Date.now()}-${path.basename(inputPath, path.extname(inputPath))}.wav`);
  try {
    await execFileAsync(
      ffmpegPath,
      ['-y', '-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', tmp],
      { maxBuffer: FFMPEG_MAX_BUFFER }
    );
    return tmp;
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* never created */ }
    throw new Error(`ffmpeg transcode failed: ${err.stderr || err.message}`);
  }
}

// Probe an audio file's duration in seconds via ffmpeg's stderr (no ffprobe
// binding in our toolchain). Returns null if duration can't be parsed.
async function getAudioDurationSec(audioPath) {
  try {
    const ffmpegPath = getFFmpegPath();
    const { stdout, stderr } = await execFileAsync(
      ffmpegPath,
      ['-i', audioPath, '-f', 'null', '-'],
      { maxBuffer: FFMPEG_MAX_BUFFER }
    ).catch((e) => ({ stdout: '', stderr: e.stderr || e.message }));
    const output = stdout + stderr;
    const m = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const s = parseInt(m[3], 10);
      const cs = parseInt(m[4], 10);
      return h * 3600 + min * 60 + s + cs / 100;
    }
  } catch (_) {
    // fall through
  }
  return null;
}

// Initialize database
async function initDatabase() {
  // Check for custom database location in settings
  let dbPath;
  
  try {
    // Try to read settings file first
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.databaseLocation) {
        dbPath = path.join(settings.databaseLocation, DB_FILENAME);
      }
    }
  } catch (error) {
    console.log('No custom database location found, using default');
  }
  
  // Default location if not set
  if (!dbPath) {
    const userDataPath = app.getPath('userData');
    dbPath = path.join(userDataPath, DB_FILENAME);
  }
  
  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  console.log('Database location:', dbPath);
  db = new Database(dbPath);

  // Schema declares ON DELETE CASCADE on project_transcripts,
  // project_chat_*, project_analysis, transcript_segments, transcript_topics.
  // SQLite defaults to foreign_keys=OFF per connection, so without this
  // every cascade is a no-op and deletes leave orphan rows.
  db.pragma('foreign_keys = ON');

  // Load and execute schema
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  
  // Run migrations to ensure all columns exist
  runMigrations();
  
  // Store current db path in memory
  global.dbPath = dbPath;
  
  return db;
}

// Function to check and add missing columns
function runMigrations() {
  try {
    // Get existing columns for transcripts table
    const columns = db.prepare("PRAGMA table_info(transcripts)").all();
    const columnNames = columns.map(col => col.name);
    
    // Define required columns with their SQL definitions
    const requiredColumns = [
      { name: 'sentiment_overall', sql: 'ALTER TABLE transcripts ADD COLUMN sentiment_overall TEXT' },
      { name: 'sentiment_score', sql: 'ALTER TABLE transcripts ADD COLUMN sentiment_score REAL' },
      { name: 'emotions', sql: 'ALTER TABLE transcripts ADD COLUMN emotions TEXT' },
      { name: 'speaker_count', sql: 'ALTER TABLE transcripts ADD COLUMN speaker_count INTEGER DEFAULT 1' },
      { name: 'speakers', sql: 'ALTER TABLE transcripts ADD COLUMN speakers TEXT' },
      { name: 'notable_quotes', sql: 'ALTER TABLE transcripts ADD COLUMN notable_quotes TEXT' },
      { name: 'research_themes', sql: 'ALTER TABLE transcripts ADD COLUMN research_themes TEXT' },
      { name: 'qa_pairs', sql: 'ALTER TABLE transcripts ADD COLUMN qa_pairs TEXT' },
      { name: 'concept_frequency', sql: 'ALTER TABLE transcripts ADD COLUMN concept_frequency TEXT' },
      { name: 'validated_text', sql: 'ALTER TABLE transcripts ADD COLUMN validated_text TEXT' },
      { name: 'validation_changes', sql: 'ALTER TABLE transcripts ADD COLUMN validation_changes TEXT' },
      { name: 'processed_text', sql: 'ALTER TABLE transcripts ADD COLUMN processed_text TEXT' },
      { name: 'personal_notes', sql: 'ALTER TABLE transcripts ADD COLUMN personal_notes TEXT' }
    ];
    
    // Add missing columns
    for (const column of requiredColumns) {
      if (!columnNames.includes(column.name)) {
        console.log(`Adding missing column: ${column.name}`);
        db.exec(column.sql);
      }
    }
    
    // Check if transcript_segments table exists and create it if not
    const segmentsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_segments'").all();
    if (segmentsTable.length === 0) {
      console.log('Creating transcript_segments table...');
      db.exec(`
        CREATE TABLE transcript_segments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transcript_id TEXT NOT NULL,
          sentence_index INTEGER NOT NULL,
          text TEXT NOT NULL,
          start_time REAL,
          end_time REAL,
          speaker TEXT,
          confidence REAL,
          version TEXT DEFAULT 'original',
          source_chunk_index INTEGER,
          word_count INTEGER,
          sentiment TEXT,
          emotions TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
        )
      `);
      
      // Create indexes
      db.exec(`
        CREATE INDEX idx_transcript_segments_transcript_id ON transcript_segments(transcript_id);
        CREATE INDEX idx_transcript_segments_sentence_index ON transcript_segments(transcript_id, sentence_index);
        CREATE INDEX idx_transcript_segments_version ON transcript_segments(transcript_id, version);
        CREATE INDEX idx_transcript_segments_speaker ON transcript_segments(transcript_id, speaker);
        CREATE INDEX idx_transcript_segments_time ON transcript_segments(transcript_id, start_time);
      `);
      
      console.log('transcript_segments table created successfully');
    } else {
      console.log('transcript_segments table already exists');
    }

    // transcript_topics — caches per-transcript topic clusters (Topics tab).
    // Recomputed on user demand; ON DELETE CASCADE so it tracks the parent.
    const topicsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_topics'").all();
    if (topicsTable.length === 0) {
      console.log('Creating transcript_topics table...');
      db.exec(`
        CREATE TABLE transcript_topics (
          id TEXT PRIMARY KEY,
          transcript_id TEXT NOT NULL,
          topic_index INTEGER NOT NULL,
          label TEXT NOT NULL,
          summary TEXT,
          chunk_ids TEXT NOT NULL,
          centroid TEXT,
          model_used TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
        )
      `);
      db.exec(`
        CREATE INDEX idx_transcript_topics_transcript ON transcript_topics(transcript_id);
        CREATE INDEX idx_transcript_topics_order ON transcript_topics(transcript_id, topic_index);
      `);
      console.log('transcript_topics table created');
    }

    // Check if ai_prompts table exists and create it if not
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_prompts'").all();
    if (tables.length === 0) {
      console.log('Creating ai_prompts table...');
      db.exec(`
        CREATE TABLE ai_prompts (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          prompt_text TEXT NOT NULL,
          variables TEXT,
          model_compatibility TEXT,
          default_prompt BOOLEAN DEFAULT 0,
          user_modified BOOLEAN DEFAULT 0,
          system_used BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create indexes
      db.exec(`
        CREATE INDEX idx_ai_prompts_category ON ai_prompts(category);
        CREATE INDEX idx_ai_prompts_type ON ai_prompts(type);
        CREATE INDEX idx_ai_prompts_category_type ON ai_prompts(category, type);
      `);
      
      console.log('ai_prompts table created successfully');
    } else {
      // Check if system_used column exists, add it if not
      const columns = db.prepare("PRAGMA table_info(ai_prompts)").all();
      const hasSystemUsedColumn = columns.some(col => col.name === 'system_used');
      
      if (!hasSystemUsedColumn) {
        console.log('Adding system_used column to ai_prompts table...');
        db.exec('ALTER TABLE ai_prompts ADD COLUMN system_used BOOLEAN DEFAULT 0');
      }
    }
    
    // Always try to initialize default prompts (in case they're missing)
    initializeDefaultPrompts();
    
    console.log('Database migrations completed');
  } catch (error) {
    console.error('Error running migrations:', error);
  }
}

// Initialize default AI prompts
function initializeDefaultPrompts() {
  try {
    console.log('Initializing default AI prompts...');
    
    const defaultPrompts = [
      // Chat Prompts
      {
        id: 'chat-transcript-system',
        category: 'chat',
        type: 'transcript_chat',
        name: 'Transcript Chat System Prompt',
        description: 'System prompt for chatting with individual transcripts',
        prompt_text: `You are an AI assistant helping analyze a transcript titled "{title}". 

Your role is to answer questions about the transcript content accurately and helpfully. 

Guidelines:
- Base your answers primarily on the provided transcript content
- If information isn't in the transcript, clearly state that
- Include timestamps when referencing specific parts of the transcript
- Be conversational but accurate
- If the user asks about speakers, use the speaker names/labels from the transcript

Context provided:
{context}

Current question: {message}`,
        variables: JSON.stringify(['title', 'context', 'message']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },
      {
        id: 'chat-conversation-compaction',
        category: 'chat',
        type: 'conversation_compaction',
        name: 'Conversation Memory Compaction',
        description: 'Prompt for compacting long chat conversations',
        prompt_text: `You are helping manage a conversation between a user and an AI assistant about a transcript. 
Please create a concise summary of the conversation below, preserving:
- Key topics discussed
- Important questions asked  
- Main conclusions reached
- Any specific transcript references or timestamps mentioned

Keep the summary to 2-3 bullet points maximum. Focus on what would be useful context for continuing the conversation.

Conversation to summarize:
{conversation}`,
        variables: JSON.stringify(['conversation']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },

      // Analysis Prompts
      {
        id: 'analysis-basic',
        category: 'analysis',
        type: 'basic_analysis',
        name: 'Basic Transcript Analysis',
        description: 'Extract summary, key topics, and action items',
        prompt_text: `Please analyze the following transcript and provide:
1. A concise summary (2-3 sentences)
2. Key topics discussed (as a bullet list)
3. Action items or next steps mentioned (as a bullet list)

Transcript:
{transcript}

Please format your response as JSON:
{
  "summary": "Your summary here",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "actionItems": ["action1", "action2", "action3"]
}`,
        variables: JSON.stringify(['transcript']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },
      {
        id: 'analysis-sentiment',
        category: 'analysis',
        type: 'sentiment_analysis',
        name: 'Sentiment Analysis',
        description: 'Analyze overall sentiment and provide score',
        prompt_text: `Analyze the sentiment of this transcript. Provide:
1. Overall sentiment: positive, negative, or neutral
2. Sentiment score: -1.0 (very negative) to 1.0 (very positive)

Transcript: {transcript}

Respond in JSON format:
{"sentiment": "positive|negative|neutral", "sentimentScore": 0.0}`,
        variables: JSON.stringify(['transcript']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },
      {
        id: 'analysis-emotions',
        category: 'analysis',
        type: 'emotion_analysis',
        name: 'Emotion Analysis',
        description: 'Detect emotional content and intensity',
        prompt_text: `Analyze the emotional content of this transcript. Rate each emotion from 0.0 to 1.0:

Emotions to analyze: frustration, excitement, confusion, confidence, anxiety, satisfaction

Transcript: {transcript}

Respond in JSON format:
{"frustration": 0.0, "excitement": 0.0, "confusion": 0.0, "confidence": 0.0, "anxiety": 0.0, "satisfaction": 0.0}`,
        variables: JSON.stringify(['transcript']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },
      {
        id: 'analysis-research',
        category: 'analysis',
        type: 'research_analysis',
        name: 'Research Analysis',
        description: 'Extract quotes, themes, Q&A pairs, and concepts for qualitative research',
        prompt_text: `Please perform detailed research analysis on the following transcript for qualitative research purposes:

1. **Notable Quotes**: Extract 3-5 most significant, quotable statements that capture key insights, surprising revelations, or memorable expressions. Rate each quote's relevance (0.0 to 1.0).

2. **Research Themes**: Identify 3-7 major themes or categories that emerge from the content. These should be suitable for qualitative research coding. Provide confidence scores (0.0 to 1.0) and specific examples for each theme.

3. **Question-Answer Mapping**: If this appears to be an interview or Q&A session, identify clear question-answer pairs. Look for interrogative statements followed by responses.

4. **Concept Frequency**: Identify key concepts, technical terms, or important topics mentioned repeatedly. Count occurrences and provide brief context snippets.

Transcript:
{transcript}

Please format your response as JSON:
{
  "notableQuotes": [
    {
      "text": "The exact quote text here",
      "speaker": "Speaker 1",
      "relevance": 0.9
    }
  ],
  "researchThemes": [
    {
      "theme": "Technology Adoption",
      "confidence": 0.85,
      "examples": ["specific example 1", "specific example 2"]
    }
  ],
  "qaPairs": [
    {
      "question": "What do you think about...",
      "answer": "I believe that...",
      "speaker": "Speaker 2"
    }
  ],
  "conceptFrequency": {
    "artificial intelligence": {
      "count": 5,
      "contexts": ["context snippet 1", "context snippet 2"]
    }
  }
}`,
        variables: JSON.stringify(['transcript']),
        model_compatibility: JSON.stringify(['llama3', 'gpt-4', 'claude']),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },

      // Speaker Analysis Prompts
      {
        id: 'speaker-count-detection',
        category: 'speaker',
        type: 'speaker_count',
        name: 'Speaker Count Detection',
        description: 'Determine number of distinct speakers',
        prompt_text: `Analyze this transcript and determine how many distinct speakers are present.
Consider:
- Changes in perspective (I/you/we)
- Question and answer patterns
- Different speaking styles

Transcript excerpt (first 500 chars):
{transcript}...

Respond with ONLY a JSON object:
{"speaker_count": N}`,
        variables: JSON.stringify(['transcript']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },
      {
        id: 'speaker-pattern-analysis',
        category: 'speaker',
        type: 'speaker_pattern_analysis',
        name: 'Speaker Pattern Analysis',
        description: 'Analyze conversation patterns for speaker tagging guidance',
        prompt_text: `Analyze this conversation to understand speaker patterns and provide guidance for tagging.

Transcript:
{transcript}...

Look for:
- Who asks questions vs who answers
- Different speaking styles or vocabulary
- Conversation flow patterns

Respond with ONLY a JSON object:
{"speaker1_role": "interviewer|interviewee|participant", "speaker2_role": "interviewer|interviewee|participant", "main_patterns": ["pattern1", "pattern2"], "question_asker": "Speaker 1|Speaker 2"}`,
        variables: JSON.stringify(['transcript']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 0
      },
      {
        id: 'speaker-tagging',
        category: 'speaker',
        type: 'speaker_tagging',
        name: 'Speaker Tagging',
        description: 'Assign speakers to text segments',
        prompt_text: `You are analyzing a conversation to identify which speaker said each sentence. You will see the full conversation context to understand speaker patterns and roles.

Context: This is {speaker_context}.

Available speakers: {speakers}

{pattern_guidance}

Full Conversation:
{transcript}

Sentences to tag:
{segments}

Analyze the full conversation context and identify patterns like:
- Questions vs answers (interviewers ask, interviewees respond)
- Speaking style consistency
- Conversation flow and turn-taking
- Topic introduction vs responses

Respond with ONLY a JSON object mapping ALL sentence numbers to speaker names:
{"assignments": {"0": "Speaker 1", "1": "Speaker 1", "2": "Speaker 2", "3": "Speaker 1", "4": "Speaker 2", ...}}`,
        variables: JSON.stringify(['speaker_context', 'speakers', 'pattern_guidance', 'transcript', 'segments']),
        model_compatibility: JSON.stringify(['llama3', 'gpt-4', 'claude']),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      },

      // Validation Prompts
      {
        id: 'validation-transcript',
        category: 'validation',
        type: 'transcript_validation',
        name: 'Transcript Validation',
        description: 'Correct spelling, grammar, and punctuation errors',
        prompt_text: `Please validate and correct the following transcript. Focus on:
{validation_options}

Important: 
- Preserve the original meaning and speaker intent
- Do not change technical terms or proper nouns unless clearly misspelled
- Return the corrected text and a list of changes made

Original transcript:
{transcript}

Please format your response as JSON:
{
  "validatedText": "The corrected transcript text",
  "changes": [
    {
      "type": "spelling|grammar|punctuation|capitalization",
      "original": "original text",
      "corrected": "corrected text",
      "position": 0
    }
  ]
}`,
        variables: JSON.stringify(['validation_options', 'transcript']),
        model_compatibility: JSON.stringify('all'),
        default_prompt: 1,
        user_modified: 0,
        system_used: 1
      }
    ];

    for (const prompt of defaultPrompts) {
      // Check if prompt already exists
      const existing = db.prepare('SELECT id FROM ai_prompts WHERE id = ?').get(prompt.id);
      
      if (!existing) {
        db.prepare(`
          INSERT INTO ai_prompts 
          (id, category, type, name, description, prompt_text, variables, 
           model_compatibility, default_prompt, user_modified, system_used, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          prompt.id, prompt.category, prompt.type, prompt.name,
          prompt.description, prompt.prompt_text, prompt.variables,
          prompt.model_compatibility, prompt.default_prompt, prompt.user_modified,
          prompt.system_used || 0,
          new Date().toISOString(), new Date().toISOString()
        );
        
        console.log(`Inserted default prompt: ${prompt.name}`);
      }
    }
    
    console.log('Default prompts initialization completed');
  } catch (error) {
    console.error('Error initializing default prompts:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Run the renderer in the OS/Chromium sandbox. The preload is
      // sandbox-safe — it only uses contextBridge/ipcRenderer/webUtils and
      // process.platform/versions, all available in a sandboxed preload, and
      // delegates every privileged op (DB, fs, ffmpeg, sidecar) over IPC.
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    show: false
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Force ALL window.open() calls from the renderer to open in the user's
  // system browser instead of spawning a child Electron BrowserWindow. This
  // is the fix for "clicking a link opens an ugly Electron child window
  // instead of my real browser". Returning { action: 'deny' } cancels the
  // child window; shell.openExternal hands the URL to the OS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Belt-and-braces: also catch in-page navigation attempts (e.g. <a href>
  // without target=_blank). Anything that tries to navigate away from the
  // app shell to an external URL gets handed to the OS browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    const isInternal =
      url.startsWith('http://localhost:') ||
      url.startsWith('file://') ||
      url === currentUrl ||
      url.startsWith(currentUrl.split('#')[0] + '#'); // hash navigation in HashRouter
    if (!isInternal && (url.startsWith('http://') || url.startsWith('https://'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle any loading errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  // Electron ≥28: console-message uses a single Event object instead of
  // positional (level, message, line, sourceId) args.
  mainWindow.webContents.on('console-message', (e) => {
    console.log('Console:', e.message);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Menu setup
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Upload',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu-action', 'new-upload');
          }
        },
        { type: 'separator' },
        {
          label: 'Preferences',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('navigate', 'settings');
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Debrief',
          click: () => {
            mainWindow.webContents.send('menu-action', 'show-about');
          }
        },
        {
          label: 'User Guide',
          enabled: true,
          click: () => {
            // Open the in-app docs page (no more system browser hop)
            mainWindow.webContents.send('navigate', 'docs');
          }
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => {
            shell.openExternal(URLS.REPO);
          }
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal(URLS.ISSUES);
          }
        },
        {
          label: 'Licenses',
          click: () => {
            mainWindow.webContents.send('menu-action', 'show-licenses');
          }
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers

// Per-domain DB RPC modules. Every renderer DB read/write goes through one
// of these — each domain validates inputs and uses prepared statements, so
// no SQL crosses the IPC boundary. This fully replaced the old generic
// db-query handler (removed in Tier 0.6 / C-SEC-3 — see docs/AUDIT-2026-05-21.md).
//
// We pass a `() => db` getter rather than `db` itself so the handlers
// resolve the current handle on each call — change-database-location
// closes and reopens the db, which would otherwise leave the RPC layer
// pointing at a closed connection.
const dbRpc = require('./electron/db-rpc');
const maintenance = require('./electron/db-rpc/maintenance');
const { autoUpdater } = require('electron-updater');
let dbRpcRegistered = false;

// Wire GitHub-releases auto-update. electron-updater reads the feed from the
// app-update.yml that electron-builder generates from electron-builder.json's
// `publish` block (github / michael-borck / debrief). Only meaningful in a
// packaged build — dev has no update feed — so we no-op otherwise. This is
// what makes the published latest*.yml manifests actually do something.
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.logger = console;
  autoUpdater.on('update-available', (info) => console.log(`[updater] update available: ${info.version}`));
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('download-progress', (p) => console.log(`[updater] downloading ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', (info) => console.log(`[updater] ${info.version} downloaded; installs on quit`));
  autoUpdater.on('error', (err) => console.error('[updater] error:', err == null ? 'unknown' : (err.stack || err).toString()));
  // Downloads in the background and shows a native notification when ready;
  // the update is applied on next quit.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('[updater] check failed:', err));
}
function ensureDbRpcRegistered() {
  if (dbRpcRegistered) return;
  dbRpc.registerAll(ipcMain, () => db);
  dbRpcRegistered = true;
}

ipcMain.handle('dialog-open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio/Video', extensions: ['mp3', 'wav', 'mp4', 'avi', 'mov', 'm4a', 'webm', 'ogg'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled) {
    return result.filePaths;
  }
  return [];
});

ipcMain.handle('dialog-save-file', async (event, { defaultPath, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters
  });

  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});

ipcMain.handle('get-app-path', async (event, type) => {
  return app.getPath(type);
});

ipcMain.handle('get-database-info', async () => {
  const stats = fs.statSync(global.dbPath);
  return {
    path: global.dbPath,
    size: stats.size,
    modified: stats.mtime
  };
});

ipcMain.handle('change-database-location', async (event, newPath) => {
  try {
    const oldDbPath = global.dbPath;
    const newDbPath = path.join(newPath, DB_FILENAME);
    
    // Ensure new directory exists
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    
    // Close current database
    if (db) {
      db.close();
    }
    
    // Copy database to new location
    fs.copyFileSync(oldDbPath, newDbPath);
    
    // Save settings
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const settings = fs.existsSync(settingsPath) 
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : {};
    
    settings.databaseLocation = newPath;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    
    // Reinitialize with new location
    await initDatabase();
    
    return { success: true, newPath: newDbPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('backup-database', async (event, backupPath) => {
  try {
    fs.copyFileSync(global.dbPath, backupPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('show-item-in-folder', (event, fullPath) => {
  shell.showItemInFolder(fullPath);
});

ipcMain.handle('test-service-connection', async (event, { url }) => {
  // Used by the AI analysis service (Ollama) only. Speech-to-text is now
  // entirely local — no connection to test there.
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return { success: true, status: response.status };
    }
    return { success: false, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ollama-models', async (event, { url }) => {
  try {
    const response = await fetch(`${url}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, models: data.models || [] };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-model-info', async (event, { url, modelName }) => {
  try {
    const response = await fetch(`${url}/api/show/${modelName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: modelName
      }),
      signal: AbortSignal.timeout(10000) // Longer timeout for model info
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, info: data };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * AI chat IPC handler. The name is kept as 'chat-with-ollama' for
 * back-compat with existing renderer code, but internally it dispatches
 * through the ai-providers module so any configured provider
 * (Ollama, OpenAI, Anthropic, Groq, Gemini, OpenRouter, Custom) works.
 */
ipcMain.handle('chat-with-ollama', async (event, { prompt, message, context }) => {
  try {
    const providerRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiProvider');
    const urlRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiAnalysisUrl');
    const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiApiKey');
    const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiModel');

    const provider = providerRow?.value || 'ollama';
    const info = aiProviders.getProviderInfo(provider);
    const url = urlRow?.value || info.defaultUrl;
    // API key may be safeStorage-encrypted; decrypt before use
    const apiKey = decryptIfNeeded(keyRow?.value || '');
    const model = modelRow?.value || '';

    // A key was saved but decrypted to empty -> decryption failed (most often
    // the OS keychain rotated/changed). Silently sending an empty key would
    // surface as a confusing auth error, so tell the user to re-enter it —
    // but only for providers that actually require a key (not local Ollama).
    if (info.requiresKey && keyRow?.value && !apiKey) {
      return {
        success: false,
        response: '',
        error: 'Your saved API key could not be decrypted (the OS keychain may have changed since you saved it). Please re-enter it in Settings.',
      };
    }

    console.log('AI chat request:', {
      provider,
      url,
      model,
      promptLength: prompt?.length ?? 0,
      hasKey: !!apiKey,
    });

    const result = await aiProviders.chat(provider, url, apiKey, model, prompt);
    if (result.success && result.usage) {
      recordUsage(provider, model, result.usage);
    }
    return {
      success: result.success,
      response: result.response || '',
      error: result.error,
      usage: result.usage,
      model,
      provider,
    };
  } catch (error) {
    console.error('AI chat failed:', error);
    return { success: false, response: '', error: error.message };
  }
});

/**
 * List available models for the given provider/URL/key. Used by the
 * Settings page to populate the model dropdown.
 */
ipcMain.handle('ai-list-models', async (event, { provider, url, apiKey }) => {
  try {
    const info = aiProviders.getProviderInfo(provider);
    const effectiveUrl = url || info.defaultUrl;
    return await aiProviders.listModels(provider, effectiveUrl, apiKey);
  } catch (error) {
    return { success: false, models: [], error: error.message };
  }
});

/**
 * Test connection to the given provider by attempting to list models.
 */
ipcMain.handle('ai-test-connection', async (event, { provider, url, apiKey }) => {
  try {
    const info = aiProviders.getProviderInfo(provider);
    const effectiveUrl = url || info.defaultUrl;
    return await aiProviders.testConnection(provider, effectiveUrl, apiKey);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * Expose provider metadata so the renderer can build the UI without
 * duplicating the list of providers and their defaults.
 */
ipcMain.handle('ai-get-providers', async () => {
  return Object.entries(aiProviders.PROVIDERS).map(([id, info]) => ({
    id,
    ...info,
  }));
});

// ============================================
// Session usage tracking (in-memory, not persisted)
// ============================================
//
// Session usage is an in-memory counter that resets on app restart.
// Lifetime usage is persisted in the settings table under the key
// 'aiLifetimeUsage' as a single JSON blob, so users can track total
// spend across restarts. Both accumulate simultaneously on every
// recordUsage() call.

const sessionUsage = {
  startedAt: Date.now(),
  totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
  byProvider: {}, // provider -> { promptTokens, completionTokens, totalTokens, requests, lastModel }
};

const LIFETIME_USAGE_KEY = 'aiLifetimeUsage';

function loadLifetimeUsage() {
  try {
    if (!db) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LIFETIME_USAGE_KEY);
    if (!row?.value) return null;
    return JSON.parse(row.value);
  } catch (err) {
    console.warn('[usage] failed to load lifetime usage:', err.message);
    return null;
  }
}

function saveLifetimeUsage(usage) {
  try {
    if (!db) return;
    db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(LIFETIME_USAGE_KEY, JSON.stringify(usage), new Date().toISOString());
  } catch (err) {
    console.warn('[usage] failed to save lifetime usage:', err.message);
  }
}

function emptyUsage() {
  return {
    startedAt: Date.now(),
    totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
    byProvider: {},
  };
}

function recordUsage(provider, model, usage) {
  if (!usage) return;
  const p = Number(usage.promptTokens) || 0;
  const c = Number(usage.completionTokens) || 0;
  const t = Number(usage.totalTokens) || p + c;

  // Session counter
  sessionUsage.totals.promptTokens += p;
  sessionUsage.totals.completionTokens += c;
  sessionUsage.totals.totalTokens += t;
  sessionUsage.totals.requests += 1;
  const sBucket = sessionUsage.byProvider[provider] || {
    promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, lastModel: '',
  };
  sBucket.promptTokens += p;
  sBucket.completionTokens += c;
  sBucket.totalTokens += t;
  sBucket.requests += 1;
  if (model) sBucket.lastModel = model;
  sessionUsage.byProvider[provider] = sBucket;

  // Lifetime counter (persisted)
  const lifetime = loadLifetimeUsage() || emptyUsage();
  lifetime.totals.promptTokens += p;
  lifetime.totals.completionTokens += c;
  lifetime.totals.totalTokens += t;
  lifetime.totals.requests += 1;
  const lBucket = lifetime.byProvider[provider] || {
    promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, lastModel: '',
  };
  lBucket.promptTokens += p;
  lBucket.completionTokens += c;
  lBucket.totalTokens += t;
  lBucket.requests += 1;
  if (model) lBucket.lastModel = model;
  lifetime.byProvider[provider] = lBucket;
  saveLifetimeUsage(lifetime);
}

ipcMain.handle('ai-get-usage-stats', async () => {
  const lifetime = loadLifetimeUsage();
  return {
    session: {
      startedAt: sessionUsage.startedAt,
      totals: { ...sessionUsage.totals },
      byProvider: { ...sessionUsage.byProvider },
    },
    lifetime: lifetime || {
      startedAt: Date.now(),
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
      byProvider: {},
    },
  };
});

ipcMain.handle('ai-reset-usage-stats', async (event, { scope } = {}) => {
  if (scope === 'lifetime') {
    saveLifetimeUsage(emptyUsage());
  } else if (scope === 'both') {
    sessionUsage.startedAt = Date.now();
    sessionUsage.totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
    sessionUsage.byProvider = {};
    saveLifetimeUsage(emptyUsage());
  } else {
    // Default: session only (matches existing behaviour)
    sessionUsage.startedAt = Date.now();
    sessionUsage.totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
    sessionUsage.byProvider = {};
  }
  return { success: true };
});

// ============================================
// Sensitive value encryption (Electron safeStorage)
// ============================================
//
// Used to encrypt API keys at rest in the SQLite settings table. Stored
// values are tagged with the prefix `enc:v1:` so we can detect and
// migrate plain-text legacy values automatically.
//
// safeStorage uses the OS keychain (macOS Keychain, Windows DPAPI,
// libsecret on Linux) so the encryption key never lives in our codebase.
// On Linux machines without a keyring service it falls back to plain
// text — we surface that via crypto-is-available so the UI can warn.

const ENC_PREFIX = 'enc:v1:';

/**
 * Decrypt a value that may or may not be encrypted. Used internally by
 * any main-process handler that reads a sensitive setting (e.g. the
 * API key) from the database. Plain-text legacy values pass through
 * unchanged so the auto-migration on next save can pick them up.
 */
function decryptIfNeeded(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  if (!value.startsWith(ENC_PREFIX)) return value; // legacy plain-text
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('decryptIfNeeded: OS encryption unavailable; stored secret cannot be read');
      return '';
    }
    const buffer = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    return safeStorage.decryptString(buffer);
  } catch (err) {
    console.error('Failed to decrypt sensitive setting (keychain may have changed):', err.message);
    return '';
  }
}

ipcMain.handle('crypto-is-available', async () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
});

ipcMain.handle('crypto-encrypt-string', async (event, { plain }) => {
  try {
    if (typeof plain !== 'string' || plain.length === 0) {
      return { success: true, encrypted: '' };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      // Pass through unchanged if the OS can't encrypt — better than
      // failing silently
      return { success: true, encrypted: plain, fallback: true };
    }
    const buffer = safeStorage.encryptString(plain);
    const encrypted = ENC_PREFIX + buffer.toString('base64');
    return { success: true, encrypted };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('crypto-decrypt-string', async (event, { encrypted }) => {
  try {
    if (typeof encrypted !== 'string' || encrypted.length === 0) {
      return { success: true, plain: '' };
    }
    if (!encrypted.startsWith(ENC_PREFIX)) {
      // Legacy plain-text value — return as-is so the renderer can
      // re-save it through the encrypted path on next change
      return { success: true, plain: encrypted, wasPlain: true };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'OS encryption not available — cannot decrypt stored value' };
    }
    const buffer = Buffer.from(encrypted.slice(ENC_PREFIX.length), 'base64');
    const plain = safeStorage.decryptString(buffer);
    return { success: true, plain };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('validate-transcript', async (event, { text }) => {
  try {
    // Get validation settings from database
    const validationEnabledSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('enableTranscriptValidation');
    
    if (validationEnabledSetting?.value !== 'true') {
      return {
        validatedText: text,
        changes: [],
        success: true
      };
    }

    const validationOptionsSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('validationOptions');
    const aiUrlSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiAnalysisUrl');
    const aiModelSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiModel');
    
    const options = validationOptionsSetting?.value ? JSON.parse(validationOptionsSetting.value) : {};
    const aiUrl = aiUrlSetting ? aiUrlSetting.value : 'http://localhost:11434';
    const model = aiModelSetting ? aiModelSetting.value : 'llama2';

    // Create validation options string
    const validationOptions = [
      options.spelling && 'spelling',
      options.grammar && 'grammar', 
      options.punctuation && 'punctuation',
      options.capitalization && 'capitalization'
    ].filter(Boolean).join(', ');

    if (validationOptions.length === 0) {
      return {
        validatedText: text,
        changes: [],
        success: true
      };
    }

    const prompt = `Please validate and correct the following transcript text. Focus on ${validationOptions}.

Return your response as a JSON object with the following structure:
{
  "validatedText": "the corrected text",
  "changes": [
    {
      "type": "spelling|grammar|punctuation|capitalization",
      "original": "original text",
      "corrected": "corrected text",
      "position": number
    }
  ]
}

Transcript to validate:
${text}`;

    console.log('Validating transcript with options:', validationOptions);

    const response = await fetch(`${aiUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: Math.max(text.length * 1.5, 2048),
          top_p: 0.9,
          top_k: 40
        }
      }),
      signal: AbortSignal.timeout(300000) // 5 minute timeout for validation
    });

    if (response.ok) {
      const data = await response.json();
      
      try {
        // Check if the response looks like JSON
        const responseText = data.response || '';
        if (responseText.trim().startsWith('{') && responseText.trim().endsWith('}')) {
          const validationData = JSON.parse(responseText);
          return {
            validatedText: validationData.validatedText || text,
            changes: validationData.changes || [],
            success: true
          };
        } else {
          // Response is plain text, not JSON
          console.warn('Validation response is not JSON format, using as-is');
          return {
            validatedText: responseText || text,
            changes: [],
            success: true
          };
        }
      } catch (parseError) {
        console.warn('Failed to parse validation response as JSON:', parseError.message);
        return {
          validatedText: data.response || text,
          changes: [],
          success: true
        };
      }
    } else {
      const errorText = await response.text();
      console.error('Validation API error:', response.status, errorText);
      return { 
        success: false, 
        error: `Validation failed: HTTP ${response.status}: ${errorText}`,
        validatedText: text,
        changes: []
      };
    }
  } catch (error) {
    console.error('Failed to validate transcript:', error);
    return { 
      success: false, 
      error: error.message,
      validatedText: text,
      changes: []
    };
  }
});

// fs-read-file and fs-write-file used to exist here. They accepted any
// path from the renderer and ran readFileSync/writeFileSync on it, so a
// renderer (or any XSS payload) could read ~/.ssh/id_rsa or overwrite
// ~/.zshrc. They had zero call sites in src/ at the time the audit
// found them — pure attack surface — so they have been removed. If a
// new feature needs file IO from the renderer, add a SCOPED IPC that
// validates the path against an explicit allow-list root.

ipcMain.handle('fs-get-file-stats', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return { size: stats.size, mtime: stats.mtime };
  } catch (error) {
    return { size: 0, error: error.message };
  }
});

ipcMain.handle('fs-join-path', async (event, ...pathSegments) => {
  return path.join(...pathSegments);
});

// Only legitimate caller is fileProcessor.ts cleaning up the temp WAV
// that extract-audio just wrote into os.tmpdir(). assertPathUnderTmp lives
// in public/electron/safe-paths.js so it can be unit-tested directly.
const { assertPathUnderTmp } = require('./electron/safe-paths');

ipcMain.handle('fs-delete-file', async (event, filePath) => {
  try {
    assertPathUnderTmp(filePath);
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('local-transcription-load-model', async (_event, { modelName }) => {
  // No-op: the sidecar lazily loads its faster-whisper model on the first
  // /analyse call (~5s once per process lifetime). Pre-warming would need a
  // /preload endpoint upstream. Renderer still calls this; reply success.
  return { success: true, modelName: modelName || 'base' };
});

ipcMain.handle('local-transcription-transcribe', async (event, { audioPath, modelName, enableDiarisation }) => {
  try {
    // Only the 'base' faster-whisper model is bundled in the installer cache.
    // Any other size would need an on-demand download, but HF_HUB_OFFLINE=1
    // (set in server.py so pyannote loads its gated weights from the cache
    // without a token) blocks that path. Force 'base' for now; lifting this
    // requires either bundling more sizes or a more nuanced HF_HUB_OFFLINE
    // toggle in the sidecar.
    if (modelName && modelName !== 'base' && !/^Xenova\/whisper-base$/i.test(modelName)) {
      console.warn(`[local-transcription] requested model '${modelName}' not bundled; using 'base'`);
    }
    const sidecarModel = 'base';
    let wantSpeakers = enableDiarisation !== false; // default ON

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const sendProgress = (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('local-transcription-progress', data);
        }
      } catch (_) { /* ignore */ }
    };

    // Probe duration once, used for both the short-file diarisation skip and
    // the heartbeat-progress ETA below.
    const probedDuration = await getAudioDurationSec(audioPath);

    // pyannote's 10s analysis window means files shorter than that fail
    // diarisation outright with a cryptic 'requested chunk … resulted in N
    // samples instead of …' error. Skip diarisation for short clips and
    // tell the renderer so the UI can surface a friendly notice.
    if (wantSpeakers && probedDuration !== null && probedDuration < 10) {
      console.warn(`[local-transcription] audio is ${probedDuration.toFixed(1)}s, shorter than pyannote's 10s minimum; running without diarisation`);
      wantSpeakers = false;
      sendProgress({
        stage: 'transcribing',
        percent: null,
        note: `Audio is ${probedDuration.toFixed(1)}s long — too short for speaker detection. Transcribing without speakers.`,
      });
    }

    console.log('[local-transcription] starting:', audioPath, 'with', sidecarModel, '| diarisation:', wantSpeakers);
    const totalStart = Date.now();

    sendProgress({ stage: 'transcribing', percent: 25 });

    // Transcode to canonical 16kHz mono WAV. Sidesteps pyannote's MP3
    // frame-alignment bug ('resulted in 439895 samples instead of 441000')
    // and normalises every input format before /analyse sees it.
    let analyseInputPath = audioPath;
    let tempWavPath = null;
    try {
      tempWavPath = await transcodeToWav16kMono(audioPath);
      analyseInputPath = tempWavPath;
      console.log(`[local-transcription] transcoded to ${tempWavPath}`);
    } catch (transcodeErr) {
      console.warn('[local-transcription] transcode failed; falling back to original file:', transcodeErr.message);
    }

    // /analyse is all-or-nothing — no per-chunk progress over IPC. Rather
    // than fake a creeping percentage (feels worse than honest indeterminate),
    // we just emit the stage once. ProcessingQueue renders an indeterminate
    // animated bar + elapsed-time counter while in-progress.
    let result;
    try {
      result = await sidecarClient.analyse({
        audioPath: analyseInputPath,
        diarize: wantSpeakers,
        model: sidecarModel,
      });
    } finally {
      if (tempWavPath) {
        try { fs.unlinkSync(tempWavPath); } catch (_) { /* best-effort */ }
      }
    }

    const audioSeconds = result.duration || 0;
    const totalMs = Date.now() - totalStart;
    const realtimeFactor = totalMs > 0 ? audioSeconds / (totalMs / 1000) : 0;
    console.log(`[local-transcription] analysed ${audioSeconds.toFixed(2)}s of audio in ${totalMs} ms (${realtimeFactor.toFixed(2)}x realtime)`);

    const chunkTimings = sidecarClient.segmentsToChunkTimings(result.segments);
    const speakerTurns = sidecarClient.segmentsToSpeakerTurns(result.segments);

    return {
      success: true,
      text: (result.transcript || '').trim(),
      chunkTimings,
      speakerTurns,
    };
  } catch (error) {
    console.error('[local-transcription] error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
});

// Rerun ONLY diarisation on an already-transcribed audio file. Hits the
// debrief-specific /rediarise endpoint so we skip whisper. The
// per-transcript panel passes a num_speakers hint (or null for auto) which
// pyannote actually honours.
ipcMain.handle('local-transcription-rediarise', async (event, { audioPath, overrides }) => {
  try {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }
    const numSpeakers = overrides && Number.isFinite(overrides.numSpeakers)
      ? Number(overrides.numSpeakers)
      : null;
    console.log('[local-transcription] rediarise via sidecar /rediarise:', audioPath, 'numSpeakers=', numSpeakers);

    const sendProgress = (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('local-transcription-progress', data);
        }
      } catch (_) { /* ignore */ }
    };

    sendProgress({ stage: 'diarising', percent: null });

    const t0 = Date.now();
    const result = await sidecarClient.rediarise({ audioPath, numSpeakers });
    const speakerTurns = (result.speakers || []).map(t => ({
      start: t.start, end: t.end, speaker: t.speaker,
    }));
    console.log(`[local-transcription] rediarise: ${speakerTurns.length} turns in ${Date.now() - t0} ms`);

    return {
      success: true,
      speakerTurns,
      audioDurationSeconds: 0,
    };
  } catch (error) {
    console.error('[local-transcription] rediarise error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
});


// App event handlers
app.whenReady().then(async () => {
  // Register the safe-file:// protocol handler — streams local files to
  // the renderer for the audio/video player without full-file buffering.
  // URL format: safe-file:///absolute/path/to/file.mp4
  protocol.handle('safe-file', (request) => {
    try {
      const url = new URL(request.url);
      // pathname starts with a single slash; on Windows we need to strip it
      let filePath = decodeURIComponent(url.pathname);
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      // Allow-list: only stream files the app actually imported, i.e. paths
      // present in transcripts.file_path. The scheme is registered with
      // bypassCSP, so without this any XSS in the renderer could
      // fetch('safe-file:///Users/me/.ssh/id_rsa') and exfiltrate arbitrary
      // files. Normalise both sides so separators/./.. don't sneak past.
      if (!db) {
        return new Response('Forbidden', { status: 403 });
      }
      const requested = path.resolve(filePath);
      const known = db
        .prepare('SELECT file_path FROM transcripts WHERE file_path IS NOT NULL')
        .all();
      const allowed = known.some((r) => path.resolve(r.file_path) === requested);
      if (!allowed) {
        console.warn('[safe-file protocol] rejected non-media path:', filePath);
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath)) {
        return new Response('Not Found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error('[safe-file protocol] error:', err);
      return new Response('Bad Request', { status: 400 });
    }
  });

  migrateLegacyUserDataDir();
  await initDatabase();
  ensureDbRpcRegistered();

  // Make the "trash auto-deletes after 30 days" promise real: purge expired
  // trash once per launch. FK cascade cleans up children.
  try {
    const swept = maintenance.makeMaintenance(() => db).sweepExpiredTrash();
    if (swept.transcripts || swept.projects) {
      console.log(
        `[trash sweep] purged ${swept.transcripts} transcript(s) + ${swept.projects} project(s) deleted before ${swept.cutoff}`
      );
    }
  } catch (err) {
    console.error('[trash sweep] failed:', err);
  }

  createWindow();
  createMenu();
  setupAutoUpdater();
  // Fire-and-forget; sidecar status is queryable via the sidecar:status IPC.
  sidecar.start().catch((err) => console.error('[sidecar] start failed:', err));
});

ipcMain.handle('sidecar:status', () => sidecar.getStatus());
ipcMain.handle('sidecar:restart', () => sidecar.restart());

app.on('window-all-closed', () => {
  // Closing the last window quits on every platform — including macOS, where
  // convention is "stay in dock". Deep-talk runs a heavy Python sidecar with
  // ML models in memory; no point keeping it warm with no windows open.
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Helper function for sentence segmentation
function createSentenceSegmentsFromChunks(transcriptId, chunkTimings, version = 'original') {
  console.log('createSentenceSegmentsFromChunks called with:', { 
    transcriptId, 
    chunkTimingsLength: chunkTimings?.length, 
    version 
  });

  if (!transcriptId) {
    console.error('No transcriptId provided');
    return [];
  }

  if (!chunkTimings || !Array.isArray(chunkTimings) || chunkTimings.length === 0) {
    console.error('Invalid or empty chunkTimings:', chunkTimings);
    return [];
  }

  const segments = [];
  let globalSentenceIndex = 0;

  for (let i = 0; i < chunkTimings.length; i++) {
    const chunk = chunkTimings[i];
    console.log(`Processing chunk ${i}:`, {
      chunkIndex: chunk.chunkIndex,
      startTime: chunk.startTime, 
      endTime: chunk.endTime,
      textLength: chunk.text?.length,
      textPreview: chunk.text?.substring(0, 50) + '...'
    });
    const sentences = splitIntoSentences(chunk.text);
    const chunkDuration = chunk.duration || 0;
    const totalWords = countWordsInText(chunk.text);
    const wordsPerSecond = totalWords > 0 && chunkDuration > 0 ? totalWords / chunkDuration : 0;

    let currentTime = chunk.startTime || 0;

    for (const sentence of sentences) {
      const wordCount = countWords(sentence);
      const estimatedDuration = wordsPerSecond > 0 ? wordCount / wordsPerSecond : 1;
      const endTime = currentTime + estimatedDuration;

      segments.push({
        transcriptId,
        sentenceIndex: globalSentenceIndex,
        text: sentence,
        startTime: currentTime,
        endTime: Math.min(endTime, chunk.endTime || currentTime + estimatedDuration),
        speaker: chunk.speaker || null,
        confidence: calculateConfidence(sentence, wordCount, estimatedDuration),
        version,
        sourceChunkIndex: chunk.chunkIndex,
        wordCount,
      });

      currentTime = endTime;
      globalSentenceIndex++;
    }
  }

  return segments;
}

function splitIntoSentences(text) {
  if (!text || !text.trim()) return [];

  // Simple sentence splitting
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && countWords(s) >= 2);

  return sentences;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

function countWordsInText(text) {
  const matches = text.match(/\b\w+\b/g);
  return matches ? matches.length : 0;
}

function calculateConfidence(sentence, wordCount, estimatedDuration) {
  let confidence = 0.5; // Base confidence

  // Boost confidence for well-formed sentences
  if (/^[A-Z]/.test(sentence) && /[.!?]\s*$/.test(sentence)) {
    confidence += 0.2;
  }

  // Boost confidence for reasonable word count
  if (wordCount >= 5 && wordCount <= 30) {
    confidence += 0.2;
  }

  // Boost confidence for reasonable duration (1-10 seconds per sentence)
  if (estimatedDuration >= 1 && estimatedDuration <= 10) {
    confidence += 0.1;
  }

  return Math.max(0, Math.min(1, confidence));
}

// Helper function to get FFmpeg path
function getFFmpegPath() {
  // ffmpeg-static returns an absolute path to the bundled binary. In dev
  // that path is inside node_modules and works as-is. In a packaged app
  // node_modules lives inside app.asar — but our electron-builder config
  // asarUnpacks ffmpeg-static, so the actual binary is at the parallel
  // app.asar.unpacked path. Without this swap the transcode silently
  // falls back to the original MP3 and pyannote then hits its frame
  // alignment bug ("441000 samples").
  const p = require('ffmpeg-static');
  if (app.isPackaged && p.includes('app.asar' + path.sep)) {
    return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  }
  return p;
}

// Audio extraction handler
ipcMain.handle('extract-audio', async (event, { inputPath, outputPath }) => {
  const ffmpegPath = getFFmpegPath();
  
  try {
    // Check if FFmpeg exists
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error('FFmpeg not found. Please run: npm run download-ffmpeg');
    }
    
    await execFileAsync(
      ffmpegPath,
      ['-i', inputPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', outputPath, '-y'],
      { maxBuffer: FFMPEG_MAX_BUFFER }
    );
    return { success: true };
  } catch (error) {
    console.error('Audio extraction error:', error);
    return { success: false, error: error.message };
  }
});

// Get media info handler
ipcMain.handle('get-media-info', async (event, { filePath }) => {
  const ffmpegPath = getFFmpegPath();
  
  try {
    const { stdout, stderr } = await execFileAsync(
      ffmpegPath,
      ['-i', filePath, '-f', 'null', '-'],
      { maxBuffer: FFMPEG_MAX_BUFFER }
    ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));
    const output = stdout + stderr;
    
    // Parse duration, including the fractional (centiseconds) part ffmpeg
    // prints — e.g. "Duration: 00:01:23.45" -> 83.45s, not 83.
    const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
    let duration = 0;
    if (durationMatch) {
      const hours = parseInt(durationMatch[1], 10);
      const minutes = parseInt(durationMatch[2], 10);
      const seconds = parseInt(durationMatch[3], 10);
      const frac = durationMatch[4] ? parseFloat(`0.${durationMatch[4]}`) : 0;
      duration = hours * 3600 + minutes * 60 + seconds + frac;
    }
    
    return {
      success: true,
      duration,
      hasVideo: output.includes('Video:'),
      hasAudio: output.includes('Audio:')
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Simple text-based similarity fallback
// This provides a working solution while we can enhance it later with real embeddings
function simpleTextEmbedding(text) {
  // Simple TF-IDF-like approach for basic semantic similarity
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const wordFreq = {};
  
  // Count word frequencies
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1;
  });
  
  // Create a simple 384-dimensional vector (to match expected size)
  const embedding = new Array(384).fill(0);
  
  // Use word hashes to populate embedding dimensions
  Object.keys(wordFreq).forEach(word => {
    for (let i = 0; i < word.length && i < 384; i++) {
      const charCode = word.charCodeAt(i);
      const dimension = (charCode * (i + 1)) % 384;
      embedding[dimension] += wordFreq[word] / words.length;
    }
  });
  
  // Normalize the vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }
  
  return embedding;
}

// Global instances
let embeddingPipeline = null;
let vectorStore = null;
let isEmbeddingInitialized = false;

// Embedding service — delegates to the bundled Python sidecar's /embed
// endpoint (sentence-transformers/all-MiniLM-L6-v2, 384-dim). The legacy
// simpleTextEmbedding helper is kept below as a fallback for the very brief
// window between app launch and sidecar ready, but the canonical path is
// the sidecar so chat RAG retrieval is real semantic search rather than
// keyword frequency.
ipcMain.handle('embedding-initialize', async () => {
  // Initialisation is now implicit (sidecar lazy-loads on first /embed call).
  // Keep the IPC for renderer compat — return success.
  isEmbeddingInitialized = true;
  return { success: true };
});

ipcMain.handle('embedding-embed-text', async (_event, { text, metadata }) => {
  try {
    if (sidecar.state === 'ready') {
      const res = await sidecarClient.embed([text]);
      return { embedding: res.embeddings[0], text, metadata };
    }
    // Sidecar not ready (first-launch setup running, or it crashed). Fall
    // back to the placeholder so chat doesn't hard-fail; the user gets
    // worse retrieval but the app keeps working until the sidecar comes up.
    console.warn('[embedding] sidecar not ready, using placeholder');
    return { embedding: simpleTextEmbedding(text), text, metadata };
  } catch (error) {
    console.error('Failed to embed text:', error);
    throw error;
  }
});

ipcMain.handle('embedding-embed-batch', async (_event, { texts, metadata }) => {
  try {
    if (sidecar.state === 'ready') {
      const res = await sidecarClient.embed(texts);
      return res.embeddings.map((embedding, i) => ({
        embedding,
        text: texts[i],
        metadata: metadata?.[i],
      }));
    }
    console.warn('[embedding] sidecar not ready, using placeholder for batch');
    return texts.map((text, i) => ({
      embedding: simpleTextEmbedding(text),
      text,
      metadata: metadata?.[i],
    }));
  } catch (error) {
    console.error('Failed to embed batch:', error);
    throw error;
  }
});

ipcMain.handle('embedding-update-config', async (event, config) => {
  console.log('Embedding config updated:', config);
  // Config updates would require reinitialization in a full implementation
  return { success: true };
});

// Initialize vector store
vectorStore = new MainVectorStore();

// Vector store IPC handlers
ipcMain.handle('vector-store-initialize', async (event, dbPath) => {
  try {
    await vectorStore.initialize(dbPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vector-store-store-chunks', async (event, { chunks, embeddings }) => {
  try {
    await vectorStore.storeChunks(chunks, embeddings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vector-store-search-similar', async (event, { queryEmbedding, options }) => {
  try {
    const results = await vectorStore.searchSimilar(queryEmbedding, options);
    return results;
  } catch (error) {
    console.error('Vector search error:', error);
    return [];
  }
});

ipcMain.handle('vector-store-delete-transcript-chunks', async (event, transcriptId) => {
  try {
    await vectorStore.deleteTranscriptChunks(transcriptId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vector-store-get-transcript-chunks', async (event, transcriptId) => {
  try {
    const chunks = await vectorStore.getTranscriptChunks(transcriptId);
    return chunks;
  } catch (error) {
    console.error('Error getting transcript chunks:', error);
    return [];
  }
});

ipcMain.handle('vector-store-update-chunks', async (event, { chunks, embeddings }) => {
  try {
    await vectorStore.updateChunks(chunks, embeddings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vector-store-get-stats', async () => {
  try {
    return await vectorStore.getStats();
  } catch (error) {
    console.error('Error getting vector store stats:', error);
    return {
      totalChunks: 0,
      transcripts: [],
      avgChunkSize: 0,
      speakers: []
    };
  }
});

ipcMain.handle('vector-store-close', async () => {
  try {
    await vectorStore.close();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('vector-store-reset', async () => {
  try {
    await vectorStore.reset();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Sentence Segments IPC handlers
ipcMain.handle('segments-create', async (event, { transcriptId, segments }) => {
  try {
    // Insert sentence segments into database
    const insertStmt = db.prepare(`
      INSERT INTO transcript_segments 
      (transcript_id, sentence_index, text, start_time, end_time, speaker, 
       confidence, version, source_chunk_index, word_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const segment of segments) {
      insertStmt.run(
        transcriptId,
        segment.sentenceIndex,
        segment.text,
        segment.startTime,
        segment.endTime,
        segment.speaker || null,
        segment.confidence,
        segment.version,
        segment.sourceChunkIndex,
        segment.wordCount,
        new Date().toISOString(),
        new Date().toISOString()
      );
    }

    console.log(`Created ${segments.length} sentence segments for transcript ${transcriptId}`);
    return { success: true };
  } catch (error) {
    console.error('Error creating sentence segments:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('segments-get-by-transcript', async (event, { transcriptId, version }) => {
  try {
    let query = 'SELECT * FROM transcript_segments WHERE transcript_id = ?';
    let params = [transcriptId];
    
    if (version) {
      query += ' AND version = ?';
      params.push(version);
    }
    
    query += ' ORDER BY sentence_index ASC';
    
    const segments = db.prepare(query).all(params);
    return segments;
  } catch (error) {
    console.error('Error getting sentence segments:', error);
    return [];
  }
});

ipcMain.handle('segments-update', async (event, { segmentId, updates }) => {
  try {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(new Date().toISOString()); // updated_at
    values.push(segmentId);
    
    const query = `UPDATE transcript_segments SET ${fields}, updated_at = ? WHERE id = ?`;
    db.prepare(query).run(values);
    
    return { success: true };
  } catch (error) {
    console.error('Error updating sentence segment:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('segments-delete-by-transcript', async (event, { transcriptId, version }) => {
  try {
    let query = 'DELETE FROM transcript_segments WHERE transcript_id = ?';
    let params = [transcriptId];
    
    if (version) {
      query += ' AND version = ?';
      params.push(version);
    }
    
    db.prepare(query).run(params);
    return { success: true };
  } catch (error) {
    console.error('Error deleting sentence segments:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('segments-create-from-chunks', async (event, { transcriptId, chunkTimings, version = 'original' }) => {
  try {
    console.log('=== CREATING SENTENCE SEGMENTS ===');
    console.log('Input data:', { 
      transcriptId, 
      chunkCount: chunkTimings?.length, 
      version,
      chunkTimings: chunkTimings?.map(c => ({
        chunkIndex: c.chunkIndex, 
        startTime: c.startTime, 
        endTime: c.endTime, 
        textLength: c.text?.length 
      }))
    });

    // For now, implement the segmentation logic directly here
    // Later, we can improve this by compiling the TS service or using a different approach
    const segments = createSentenceSegmentsFromChunks(transcriptId, chunkTimings, version);
    console.log(`Segmentation created ${segments.length} segments`);

    // Insert into database
    const insertStmt = db.prepare(`
      INSERT INTO transcript_segments 
      (transcript_id, sentence_index, text, start_time, end_time, speaker, 
       confidence, version, source_chunk_index, word_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const segment of segments) {
      insertStmt.run(
        segment.transcriptId,
        segment.sentenceIndex,
        segment.text,
        segment.startTime,
        segment.endTime,
        segment.speaker || null,
        segment.confidence,
        segment.version,
        segment.sourceChunkIndex,
        segment.wordCount,
        new Date().toISOString(),
        new Date().toISOString()
      );
    }

    console.log(`Created ${segments.length} sentence segments from ${chunkTimings.length} chunks for transcript ${transcriptId}`);
    return { success: true, segmentCount: segments.length };
  } catch (error) {
    console.error('Error creating sentence segments from chunks:', error);
    return { success: false, error: error.message };
  }
});

// AI Prompts IPC handlers
ipcMain.handle('ai-prompts-get-by-category', async (event, category) => {
  try {
    const prompts = db.prepare(
      'SELECT * FROM ai_prompts WHERE category = ? ORDER BY type, name'
    ).all(category);
    
    return prompts.map(prompt => ({
      id: prompt.id,
      category: prompt.category,
      type: prompt.type,
      name: prompt.name,
      description: prompt.description,
      promptText: prompt.prompt_text,
      variables: prompt.variables ? JSON.parse(prompt.variables) : [],
      modelCompatibility: prompt.model_compatibility ? JSON.parse(prompt.model_compatibility) : 'all',
      defaultPrompt: !!prompt.default_prompt,
      userModified: !!prompt.user_modified,
      systemUsed: !!prompt.system_used,
      createdAt: prompt.created_at,
      updatedAt: prompt.updated_at
    }));
  } catch (error) {
    console.error('Error getting prompts by category:', error);
    return [];
  }
});

ipcMain.handle('ai-prompts-get', async (event, { category, type }) => {
  try {
    const prompt = db.prepare(
      'SELECT * FROM ai_prompts WHERE category = ? AND type = ? ORDER BY user_modified DESC, default_prompt DESC LIMIT 1'
    ).get(category, type);
    
    if (prompt) {
      return {
        id: prompt.id,
        category: prompt.category,
        type: prompt.type,
        name: prompt.name,
        description: prompt.description,
        promptText: prompt.prompt_text,
        variables: prompt.variables ? JSON.parse(prompt.variables) : [],
        modelCompatibility: prompt.model_compatibility ? JSON.parse(prompt.model_compatibility) : 'all',
        defaultPrompt: !!prompt.default_prompt,
        userModified: !!prompt.user_modified,
        systemUsed: !!prompt.system_used,
        createdAt: prompt.created_at,
        updatedAt: prompt.updated_at
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting prompt:', error);
    return null;
  }
});

ipcMain.handle('ai-prompts-save', async (event, prompt) => {
  try {
    const existing = db.prepare('SELECT id FROM ai_prompts WHERE id = ?').get(prompt.id);

    const promptData = {
      id: prompt.id,
      category: prompt.category,
      type: prompt.type,
      name: prompt.name,
      description: prompt.description || null,
      prompt_text: prompt.promptText,
      variables: JSON.stringify(prompt.variables),
      model_compatibility: JSON.stringify(prompt.modelCompatibility),
      default_prompt: prompt.defaultPrompt ? 1 : 0,
      user_modified: prompt.userModified ? 1 : 0,
      system_used: prompt.systemUsed ? 1 : 0,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      // Update existing prompt
      db.prepare(`
        UPDATE ai_prompts SET 
        category = ?, type = ?, name = ?, description = ?, 
        prompt_text = ?, variables = ?, model_compatibility = ?, 
        default_prompt = ?, user_modified = ?, system_used = ?, updated_at = ?
        WHERE id = ?
      `).run(
        promptData.category, promptData.type, promptData.name, promptData.description,
        promptData.prompt_text, promptData.variables, promptData.model_compatibility,
        promptData.default_prompt, promptData.user_modified, promptData.system_used, promptData.updated_at,
        promptData.id
      );
    } else {
      // Insert new prompt
      db.prepare(`
        INSERT INTO ai_prompts 
        (id, category, type, name, description, prompt_text, variables, 
         model_compatibility, default_prompt, user_modified, system_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        promptData.id, promptData.category, promptData.type, promptData.name,
        promptData.description, promptData.prompt_text, promptData.variables,
        promptData.model_compatibility, promptData.default_prompt, promptData.user_modified,
        promptData.system_used, promptData.updated_at, promptData.updated_at
      );
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving prompt:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai-prompts-delete', async (event, id) => {
  try {
    db.prepare('DELETE FROM ai_prompts WHERE id = ? AND default_prompt = 0').run(id);
    return { success: true };
  } catch (error) {
    console.error('Error deleting prompt:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai-prompts-reset-to-default', async (event, { category, type }) => {
  try {
    // Delete user customizations
    db.prepare(
      'DELETE FROM ai_prompts WHERE category = ? AND type = ? AND default_prompt = 0'
    ).run(category, type);
    return { success: true };
  } catch (error) {
    console.error('Error resetting prompt to default:', error);
    return { success: false, error: error.message };
  }
});

// Cleanup on exit. Electron does NOT await async before-quit handlers, so we
// preventDefault, run cleanup, and re-quit explicitly — otherwise the sidecar
// child process gets orphaned mid-shutdown.
let cleanupRan = false;
app.on('before-quit', (event) => {
  if (cleanupRan) return;
  event.preventDefault();
  (async () => {
    try {
      await sidecar.stop();
      if (vectorStore) {
        await vectorStore.close();
      }
      if (db) {
        db.close();
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    } finally {
      cleanupRan = true;
      app.quit();
    }
  })();
});
