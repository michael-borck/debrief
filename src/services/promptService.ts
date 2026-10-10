/**
 * Prompt Management Service
 * 
 * Handles CRUD operations for AI prompts, template variable replacement,
 * and provides default prompts for the application.
 */

export interface AIPrompt {
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
  systemUsed?: boolean; // Whether this prompt is actively used by the system
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompts: Partial<AIPrompt>[];
}

export class PromptService {
  
  /**
   * Get all prompts by category
   */
  async getPromptsByCategory(category: AIPrompt['category']): Promise<AIPrompt[]> {
    try {
      const prompts = await window.electronAPI.aiPrompts.getByCategory(category);
      return prompts;
    } catch (error) {
      console.error('Error getting prompts by category:', error);
      return [];
    }
  }

  /**
   * Get a specific prompt by category and type
   */
  async getPrompt(category: string, type: string): Promise<AIPrompt | null> {
    try {
      const prompt = await window.electronAPI.aiPrompts.get({ category, type });
      
      if (prompt) {
        return prompt;
      }
      
      // If no custom prompt exists, return the default
      return this.getDefaultPrompt(category, type);
    } catch (error) {
      console.error('Error getting prompt:', error);
      return this.getDefaultPrompt(category, type);
    }
  }

  /**
   * Save or update a prompt
   */
  async savePrompt(prompt: Omit<AIPrompt, 'createdAt' | 'updatedAt'>): Promise<boolean> {
    try {
      const result = await window.electronAPI.aiPrompts.save(prompt);
      return result.success;
    } catch (error) {
      console.error('Error saving prompt:', error);
      return false;
    }
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(id: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.aiPrompts.delete(id);
      return result.success;
    } catch (error) {
      console.error('Error deleting prompt:', error);
      return false;
    }
  }

  /**
   * Reset a prompt to default
   */
  async resetToDefault(category: string, type: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.aiPrompts.resetToDefault({ category, type });
      return result.success;
    } catch (error) {
      console.error('Error resetting prompt to default:', error);
      return false;
    }
  }


  /**
   * Get a prompt and replace its template variables in one call
   * This is the main method other services should use
   */
  async getProcessedPrompt(category: string, type: string, variables: Record<string, string>): Promise<string> {
    try {
      const prompt = await this.getPrompt(category, type);
      if (!prompt) {
        console.warn(`No prompt found for ${category}:${type}, using fallback`);
        return this.getFallbackPrompt(category, type, variables);
      }
      
      return this.replaceVariables(prompt.promptText, variables);
    } catch (error) {
      console.error(`Error getting processed prompt for ${category}:${type}:`, error);
      return this.getFallbackPrompt(category, type, variables);
    }
  }

  /**
   * Replace template variables in a prompt
   */
  replaceVariables(promptText: string, variables: Record<string, string>): string {
    let result = promptText;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(regex, value);
    }
    
    return result;
  }

  /**
   * Fallback prompts in case database prompts fail to load
   */
  private getFallbackPrompt(category: string, type: string, variables: Record<string, string>): string {
    const fallbacks: Record<string, Record<string, string>> = {
      analysis: {
        basic_analysis: `Analyze this transcript: ${variables.transcript || '[transcript]'}\n\nProvide: summary, key topics, action items in JSON format.`,
        sentiment_analysis: `Analyze sentiment of: ${variables.transcript || '[transcript]'}\n\nReturn JSON with sentiment and score.`,
        research_analysis: `Perform research analysis on: ${variables.transcript || '[transcript]'}\n\nExtract quotes, themes, Q&A pairs, concepts in JSON.`
      },
      chat: {
        transcript_chat: `You are analyzing a transcript. Answer questions about: ${variables.context || '[context]'}\n\nQuestion: ${variables.message || '[message]'}`,
        conversation_compaction: `Summarize this conversation in 2-3 bullet points: ${variables.conversation || '[conversation]'}`
      },
      speaker: {
        speaker_count: `Count speakers in: ${variables.transcript || '[transcript]'}\n\nReturn JSON with speaker_count.`,
        speaker_tagging: `Tag speakers in segments: ${variables.segments || '[segments]'}\n\nReturn JSON with assignments.`
      },
      validation: {
        transcript_validation: `Correct this transcript: ${variables.transcript || '[transcript]'}\n\nReturn JSON with validatedText and changes.`
      }
    };

    const fallback = fallbacks[category]?.[type];
    if (fallback) {
      console.log(`Using fallback prompt for ${category}:${type}`);
      return fallback;
    }

    console.error(`No fallback available for ${category}:${type}`);
    return `Please process: ${Object.values(variables).join(' ')}`;
  }

  /**
   * Extract variables from a prompt template
   */
  extractVariables(promptText: string): string[] {
    const matches = promptText.match(/\{([^}]+)\}/g);
    if (!matches) return [];
    
    return [...new Set(matches.map(match => match.slice(1, -1)))];
  }


  /**
   * Get default prompt for a category/type
   */
  private getDefaultPrompt(category: string, type: string): AIPrompt | null {
    const defaults = this.getDefaultPrompts();
    return defaults.find(p => p.category === category && p.type === type) || null;
  }

  /**
   * Define all default prompts based on current codebase
   */
  private getDefaultPrompts(): AIPrompt[] {
    return [
      // Chat Prompts
      {
        id: 'chat-transcript-system',
        category: 'chat',
        type: 'transcript_chat',
        name: 'Transcript Chat System Prompt',
        description: 'System prompt for chatting with individual transcripts',
        promptText: `You are an AI assistant helping analyze a transcript titled "{title}". 

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
        variables: ['title', 'context', 'message'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      {
        id: 'chat-conversation-compaction',
        category: 'chat',
        type: 'conversation_compaction',
        name: 'Conversation Memory Compaction',
        description: 'Prompt for compacting long chat conversations',
        promptText: `You are helping manage a conversation between a user and an AI assistant about a transcript. 
Please create a concise summary of the conversation below, preserving:
- Key topics discussed
- Important questions asked  
- Main conclusions reached
- Any specific transcript references or timestamps mentioned

Keep the summary to 2-3 bullet points maximum. Focus on what would be useful context for continuing the conversation.

Conversation to summarize:
{conversation}`,
        variables: ['conversation'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      // Analysis Prompts
      {
        id: 'analysis-basic',
        category: 'analysis',
        type: 'basic_analysis',
        name: 'Basic Transcript Analysis',
        description: 'Extract summary, key topics, and action items',
        promptText: `Please analyze the following transcript and provide:
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
        variables: ['transcript'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      {
        id: 'analysis-sentiment',
        category: 'analysis',
        type: 'sentiment_analysis',
        name: 'Sentiment Analysis',
        description: 'Analyze overall sentiment and provide score',
        promptText: `Analyze the sentiment of this transcript. Provide:
1. Overall sentiment: positive, negative, or neutral
2. Sentiment score: -1.0 (very negative) to 1.0 (very positive)

Transcript: {transcript}

Respond in JSON format:
{"sentiment": "positive|negative|neutral", "sentimentScore": 0.0}`,
        variables: ['transcript'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      {
        id: 'analysis-emotions',
        category: 'analysis',
        type: 'emotion_analysis',
        name: 'Emotion Analysis',
        description: 'Detect emotional content and intensity',
        promptText: `Analyze the emotional content of this transcript. Rate each emotion from 0.0 to 1.0:

Emotions to analyze: frustration, excitement, confusion, confidence, anxiety, satisfaction

Transcript: {transcript}

Respond in JSON format:
{"frustration": 0.0, "excitement": 0.0, "confusion": 0.0, "confidence": 0.0, "anxiety": 0.0, "satisfaction": 0.0}`,
        variables: ['transcript'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      {
        id: 'analysis-research',
        category: 'analysis',
        type: 'research_analysis',
        name: 'Research Analysis',
        description: 'Extract quotes, themes, Q&A pairs, and concepts for qualitative research',
        promptText: `Please perform detailed research analysis on the following transcript for qualitative research purposes:

1. **Notable Quotes**: Extract 3-5 most significant, quotable statements that capture key insights, surprising revelations, or memorable expressions. Rate each quote's relevance (0.0 to 1.0).

2. **Research Themes**: Identify 3-7 major themes or categories that emerge from the content. These should be suitable for qualitative research coding. Provide confidence scores (0.0 to 1.0) and specific examples for each theme.

3. **Question-Answer Mapping**: If this appears to be an interview or Q&A session, identify clear question-answer pairs. Look for interrogative statements followed by responses.

4. **Concept Frequency**: Identify key concepts, technical terms, or important topics mentioned repeatedly. Count occurrences and provide brief context snippets.

Transcript:
{transcript}

The transcript is prefixed with speaker labels in square brackets, for example
"[SPEAKER_00]: ...". Attribute every quote and every question to the speaker whose
labelled block it came from, copying the label exactly (e.g. "SPEAKER_00"). If a
passage spans more than one speaker, attribute it to the one who spoke the words
you are quoting. Do not invent speaker labels that do not appear in the text.

Please format your response as JSON:
{
  "notableQuotes": [
    {
      "text": "The exact quote text here",
      "speaker": "SPEAKER_00",
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
      "questionSpeaker": "SPEAKER_00",
      "answerSpeaker": "SPEAKER_01"
    }
  ],
  "conceptFrequency": {
    "artificial intelligence": {
      "count": 5,
      "contexts": ["context snippet 1", "context snippet 2"]
    }
  }
}`,
        variables: ['transcript'],
        modelCompatibility: ['llama3', 'gpt-4', 'claude'],
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      // Speaker Analysis Prompts
      {
        id: 'speaker-count-detection',
        category: 'speaker',
        type: 'speaker_count',
        name: 'Speaker Count Detection',
        description: 'Determine number of distinct speakers',
        promptText: `Analyze this transcript and determine how many distinct speakers are present.
Consider:
- Changes in perspective (I/you/we)
- Question and answer patterns
- Different speaking styles

Transcript excerpt (first 500 chars):
{transcript}...

Respond with ONLY a JSON object:
{"speaker_count": N}`,
        variables: ['transcript'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      {
        id: 'speaker-tagging',
        category: 'speaker',
        type: 'speaker_tagging',
        name: 'Speaker Tagging',
        description: 'Assign speakers to text segments',
        promptText: `You are analyzing a conversation to identify which speaker said each sentence. You will see the full conversation context to understand speaker patterns and roles.

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
        variables: ['speaker_context', 'speakers', 'pattern_guidance', 'transcript', 'segments'],
        modelCompatibility: ['llama3', 'gpt-4', 'claude'],
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },

      // Validation Prompts
      {
        id: 'validation-transcript',
        category: 'validation',
        type: 'transcript_validation',
        name: 'Transcript Validation',
        description: 'Correct spelling, grammar, and punctuation errors',
        promptText: `Please validate and correct the following transcript. Focus on:
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
        variables: ['validation_options', 'transcript'],
        modelCompatibility: 'all',
        defaultPrompt: true,
        userModified: false,
        systemUsed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }
}

// Export singleton instance
export const promptService = new PromptService();