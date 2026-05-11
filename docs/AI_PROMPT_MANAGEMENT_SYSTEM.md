# AI Prompt Management System

## Overview

DeepDebrief implements a sophisticated AI Prompt Management System that enables dynamic customization of AI interactions across different processing stages. The system provides template-based prompts with variable substitution, category-based organization, model compatibility awareness, and robust fallback mechanisms.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React UI Layer                       │
│  ├── PromptsSettings.tsx (Category Navigation)          │
│  └── PromptEditor.tsx (Rich Editing Interface)         │
├─────────────────────────────────────────────────────────┤
│                 Service Layer                           │
│  └── promptService.ts (Core Logic & API)               │
├─────────────────────────────────────────────────────────┤
│                 Database Layer                          │
│  └── SQLite (ai_prompts table)                         │
└─────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Prompt Service (`/src/services/promptService.ts`)

**Main Service Class**: `PromptService` (singleton pattern)

**Key Methods**:
- `getProcessedPrompt()` - Main API for getting prompts with variables replaced
- `getPrompt()` - Retrieves specific prompt by category/type
- `savePrompt()` - Saves or updates prompts
- `replaceVariables()` - Template variable substitution engine
- `extractVariables()` - Parses template variables from prompt text

**Primary Interface**:
```typescript
interface AIPrompt {
  id: string;
  category: 'chat' | 'analysis' | 'validation' | 'speaker';
  type: string;
  name: string;
  description?: string;
  promptText: string;
  variables: string[];
  modelCompatibility: string[] | 'all';
  defaultPrompt: boolean;
  userModified: boolean;
  systemUsed: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 2. User Interface Components

#### PromptsSettings Component (`/src/components/PromptsSettings.tsx`)
- **Category-based navigation**: Chat, Analysis, Speaker, Validation prompts
- **Search and filtering**: Real-time prompt search functionality
- **Import/Export**: JSON-based prompt sharing and backup
- **System usage indicators**: Shows which prompts are actively used by the system

#### PromptEditor Component (`/src/components/PromptEditor.tsx`)
- **Rich editing interface**: Syntax highlighting for template variables
- **Variable documentation**: Contextual help for available variables
- **Token counting**: Estimates prompt length for model compatibility
- **Reset functionality**: Restore prompts to default configurations

### 3. Database Schema

Located in `/database/schema.sql` (lines 194-209):

```sql
CREATE TABLE IF NOT EXISTS ai_prompts (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL, -- 'chat', 'analysis', 'validation', 'speaker'
    type TEXT NOT NULL, -- specific prompt type
    name TEXT NOT NULL, -- human-readable name
    description TEXT, -- help text for users
    prompt_text TEXT NOT NULL, -- the actual prompt template
    variables TEXT, -- JSON array of template variables
    model_compatibility TEXT, -- JSON array of compatible models or 'all'
    default_prompt BOOLEAN DEFAULT 0,
    user_modified BOOLEAN DEFAULT 0,
    system_used BOOLEAN DEFAULT 0, -- actively used by system pipeline
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Template System and Variable Substitution

### Variable Syntax
The system uses curly brace syntax for template variables: `{variable_name}`

### Core Template Engine
```typescript
replaceVariables(promptText: string, variables: Record<string, string>): string {
  let result = promptText;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}
```

### Supported Variables by Category

#### Chat Prompts
- `{title}` - Transcript title
- `{context}` - Relevant context from transcript
- `{message}` - User's question/message
- `{conversation}` - Previous conversation for compaction

#### Analysis Prompts
- `{transcript}` - Full transcript text
- `{validation_options}` - Selected validation options

#### Speaker Prompts
- `{transcript}` - Full conversation context
- `{speakers}` - List of available speakers
- `{segments}` - Text segments to analyze
- `{speaker_context}` - Context type (interview, meeting, etc.)
- `{pattern_guidance}` - Specific guidance patterns

#### Validation Prompts
- `{transcript}` - Original transcript text
- `{validation_options}` - Correction options selected

## Category and Type Organization

### Four Main Categories

#### 1. Chat Prompts (`category: 'chat'`)
- `transcript_chat` - System prompt for chatting with individual transcripts
- `conversation_compaction` - Memory management for long conversations

#### 2. Analysis Prompts (`category: 'analysis'`)
- `basic_analysis` - Extract summary, topics, action items
- `sentiment_analysis` - Overall sentiment and scoring
- `emotion_analysis` - Detailed emotional content detection
- `research_analysis` - Qualitative research analysis (quotes, themes, Q&A)

#### 3. Speaker Prompts (`category: 'speaker'`)
- `speaker_count` - Determine number of distinct speakers
- `speaker_tagging` - Assign speakers to text segments

#### 4. Validation Prompts (`category: 'validation'`)
- `transcript_validation` - Correct spelling, grammar, punctuation

## Model Compatibility Handling

### Compatibility Framework
- **Universal prompts**: `modelCompatibility: 'all'`
- **Model-specific prompts**: `modelCompatibility: ['llama3', 'gpt-4', 'claude']`
- **UI warnings**: Different complexity levels recommended for different model sizes

### Integration with Model Metadata Service
The system integrates with `modelMetadataService` for dynamic context management and model capability awareness.

## User Customization Capabilities

### Customization Features
1. **Prompt editing**: Full text editor with syntax highlighting
2. **Variable management**: Automatic detection and documentation
3. **Reset to defaults**: Restore system prompts without losing custom ones
4. **Import/Export**: Share prompt configurations between installations
5. **Usage indicators**: Clear marking of system-critical vs. reference prompts

### User Experience Flow
1. **Browse by category**: Organized tabs for different prompt types
2. **Search functionality**: Find prompts by name or content
3. **Edit in place**: Rich editor with validation and token counting
4. **Save with validation**: Automatic variable extraction and validation
5. **Export for backup**: JSON format for sharing and migration

## Integration Points

### Service Integration
- **File Processor**: Uses analysis and validation prompts for transcript processing
- **Chat Service**: Uses chat prompts for conversation system and memory compaction
- **Settings Page**: Dedicated prompts tab with model selection integration

### Data Flow
```
User Request → PromptService.getProcessedPrompt() → Database Query → 
Variable Substitution → AI Model → Response Processing
```

### Configuration Flow
```
UI Settings → PromptsSettings Component → PromptEditor → 
PromptService.savePrompt() → Database Storage → System Integration
```

## Error Handling and Fallback System

### Multi-Layer Fallback Strategy
1. **Primary**: Database-stored custom prompts
2. **Secondary**: System default prompts (in-memory)
3. **Tertiary**: Hardcoded fallback prompts for critical operations
4. **Final**: Generic error-recovery prompts

### Fallback Implementation
```typescript
async getProcessedPrompt(category: string, type: string, variables: Record<string, string>): Promise<string> {
  try {
    const prompt = await this.getPrompt(category, type);
    if (!prompt) {
      return this.getFallbackPrompt(category, type, variables);
    }
    return this.replaceVariables(prompt.promptText, variables);
  } catch (error) {
    return this.getFallbackPrompt(category, type, variables);
  }
}
```

## Key Implementation Strengths

1. **Type Safety**: Full TypeScript implementation with comprehensive interfaces
2. **Singleton Pattern**: Centralized service instance for consistency
3. **Separation of Concerns**: Clear boundaries between UI, service, and data layers
4. **Extensibility**: Easy to add new categories and prompt types
5. **Robustness**: Multiple fallback layers prevent system failures
6. **User Experience**: Rich UI with search, editing, and validation features
7. **Data Integrity**: Proper database schema with indexes and constraints

## Reuse Value for Other Applications

This AI Prompt Management System provides a solid foundation for any application requiring:

- **Customizable AI interactions** with template-based prompts
- **Multi-category prompt organization** for different use cases
- **Variable substitution** for dynamic content injection
- **Model compatibility handling** across different AI providers
- **User-friendly prompt editing** with rich UI components
- **Robust fallback mechanisms** for production reliability

The architecture supports both technical users who want fine-grained control and casual users who can rely on well-designed defaults.