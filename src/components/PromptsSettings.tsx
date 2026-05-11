import React, { useState, useEffect } from 'react';
import { MessageCircle, Search, Sparkles, Users, CheckCircle, AlertTriangle, Download, Upload } from 'lucide-react';
import { PromptEditor } from './PromptEditor';
import { AIPrompt } from '../services/promptService';

type PromptCategory = 'chat' | 'analysis' | 'validation' | 'speaker';

interface CategoryConfig {
  id: PromptCategory;
  name: string;
  icon: React.ReactNode;
  description: string;
  color: string;
}

export const PromptsSettings: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<PromptCategory>('chat');
  const [prompts, setPrompts] = useState<AIPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  const categories: CategoryConfig[] = [
    {
      id: 'chat',
      name: 'Chat Prompts',
      icon: <MessageCircle size={20} />,
      description: 'System prompts for transcript and project conversations',
      color: 'blue'
    },
    {
      id: 'analysis',
      name: 'Analysis Prompts',
      icon: <Sparkles size={20} />,
      description: 'Prompts for sentiment, themes, and research analysis',
      color: 'purple'
    },
    {
      id: 'speaker',
      name: 'Speaker Prompts',
      icon: <Users size={20} />,
      description: 'Speaker detection and tagging instructions',
      color: 'green'
    },
    {
      id: 'validation',
      name: 'Validation Prompts',
      icon: <CheckCircle size={20} />,
      description: 'Transcript correction and validation behavior',
      color: 'orange'
    }
  ];

  useEffect(() => {
    loadPrompts();
  }, [activeCategory]);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const categoryPrompts = await window.electronAPI.aiPrompts.getByCategory(activeCategory);
      setPrompts(categoryPrompts);
    } catch (error) {
      console.error('Error loading prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrompt = async (prompt: AIPrompt) => {
    const result = await window.electronAPI.aiPrompts.save(prompt);
    if (result.success) {
      await loadPrompts();
    } else {
      throw new Error(result.error || 'Failed to save prompt');
    }
  };

  const handleResetPrompt = async (category: string, type: string) => {
    const result = await window.electronAPI.aiPrompts.resetToDefault({ category, type });
    if (result.success) {
      await loadPrompts();
    }
  };

  const handleExportPrompts = async () => {
    const allPrompts: Record<string, AIPrompt[]> = {};
    
    for (const category of categories) {
      const categoryPrompts = await window.electronAPI.aiPrompts.getByCategory(category.id);
      allPrompts[category.id] = categoryPrompts;
    }

    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      prompts: allPrompts
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debrief-prompts-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportPrompts = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (!data.prompts || !data.version) {
          throw new Error('Invalid prompt file format');
        }

        const confirm = window.confirm(
          'This will overwrite your custom prompts with the imported ones. Continue?'
        );
        
        if (!confirm) return;

        // Import prompts
        for (const [, categoryPrompts] of Object.entries(data.prompts)) {
          for (const prompt of categoryPrompts as AIPrompt[]) {
            await window.electronAPI.aiPrompts.save({
              ...prompt,
              userModified: true
            });
          }
        }

        await loadPrompts();
        alert('Prompts imported successfully!');
      } catch (error) {
        alert('Failed to import prompts. Please check the file format.');
        console.error('Import error:', error);
      }
    };

    input.click();
  };

  const filteredPrompts = prompts.filter(prompt => 
    searchQuery === '' || 
    prompt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    prompt.promptText.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeConfig = categories.find(c => c.id === activeCategory)!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title">AI Prompts Configuration</h2>
          <p className="text-surface-600 mt-1">
            Customize prompts for better results with your AI model
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleImportPrompts}
            className="flex items-center space-x-1 px-3 py-2 text-sm border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <Upload size={16} />
            <span>Import</span>
          </button>
          <button
            onClick={handleExportPrompts}
            className="flex items-center space-x-1 px-3 py-2 text-sm border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Model Compatibility Notice */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertTriangle className="text-yellow-600 mt-0.5" size={20} />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">Optimize for your model</p>
            <p className="mt-1">
              Simpler prompts work better with smaller models (7B-13B). Complex prompts are best for larger models (70B+).
            </p>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="bg-white rounded-lg border border-surface-200">
        <div className="grid grid-cols-4 divide-x divide-surface-200">
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`
                px-4 py-4 text-center transition-colors
                ${activeCategory === category.id 
                  ? category.id === 'chat' ? 'bg-primary-100 border-b-2 border-primary-400' :
                    category.id === 'analysis' ? 'bg-purple-50 border-b-2 border-purple-500' :
                    category.id === 'speaker' ? 'bg-green-50 border-b-2 border-green-500' :
                    'bg-orange-50 border-b-2 border-orange-500'
                  : 'hover:bg-surface-50'
                }
              `}
            >
              <div className={`
                flex flex-col items-center space-y-2
                ${activeCategory === category.id 
                  ? category.id === 'chat' ? 'text-primary-700' :
                    category.id === 'analysis' ? 'text-purple-700' :
                    category.id === 'speaker' ? 'text-green-700' :
                    'text-orange-700'
                  : 'text-surface-600'
                }
              `}>
                {category.icon}
                <span className="text-sm font-medium">{category.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-surface-400" />
        <input
          type="text"
          placeholder="Search prompts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-4 py-2 w-full border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      {/* Category Description */}
      <div className={
        activeCategory === 'chat' ? 'bg-primary-100 border border-primary-200 rounded-lg p-4' :
        activeCategory === 'analysis' ? 'bg-purple-50 border border-purple-200 rounded-lg p-4' :
        activeCategory === 'speaker' ? 'bg-green-50 border border-green-200 rounded-lg p-4' :
        'bg-orange-50 border border-orange-200 rounded-lg p-4'
      }>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={
              activeCategory === 'chat' ? 'text-primary-800' :
              activeCategory === 'analysis' ? 'text-purple-600' :
              activeCategory === 'speaker' ? 'text-green-600' :
              'text-orange-600'
            }>
              {activeConfig.icon}
            </div>
            <div>
              <h3 className={
                activeCategory === 'chat' ? 'font-medium text-primary-900' :
                activeCategory === 'analysis' ? 'font-medium text-purple-900' :
                activeCategory === 'speaker' ? 'font-medium text-green-900' :
                'font-medium text-orange-900'
              }>
                {activeConfig.name}
              </h3>
              <p className={
                activeCategory === 'chat' ? 'text-sm text-primary-700 mt-1' :
                activeCategory === 'analysis' ? 'text-sm text-purple-700 mt-1' :
                activeCategory === 'speaker' ? 'text-sm text-green-700 mt-1' :
                'text-sm text-orange-700 mt-1'
              }>
                {activeConfig.description}
              </p>
            </div>
          </div>
          <div className="text-xs text-surface-600">
            {filteredPrompts.filter(p => p.systemUsed).length} system-used, {filteredPrompts.filter(p => !p.systemUsed).length} reference
          </div>
        </div>
      </div>

      {/* Prompts List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-surface-600">Loading prompts...</p>
        </div>
      ) : filteredPrompts.length === 0 ? (
        <div className="text-center py-12 bg-surface-50 rounded-lg">
          <p className="text-surface-600">
            {searchQuery ? 'No prompts found matching your search.' : 'No prompts available in this category.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPrompts.map(prompt => (
            <PromptEditor
              key={prompt.id}
              prompt={prompt}
              onSave={handleSavePrompt}
              onReset={() => handleResetPrompt(prompt.category, prompt.type)}
              isDefault={prompt.defaultPrompt && !prompt.userModified}
            />
          ))}
        </div>
      )}

      {/* Templates Section */}
      <div className="mt-8 pt-8 border-t border-surface-200">
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex items-center space-x-2 text-lg font-medium text-surface-900 hover:text-surface-700"
        >
          <span>{showTemplates ? '−' : '+'}</span>
          <span>Prompt Templates (Coming Soon)</span>
        </button>
        
        {showTemplates && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {['Academic Research', 'Business Analysis', 'Medical/Healthcare', 'Simple (7B Models)'].map(template => (
              <div key={template} className="bg-surface-50 rounded-lg p-4 opacity-50">
                <h4 className="font-medium text-surface-900">{template}</h4>
                <p className="text-sm text-surface-600 mt-1">
                  Pre-configured prompts optimized for {template.toLowerCase()}
                </p>
                <button 
                  disabled
                  className="mt-2 text-sm text-primary-800 hover:text-primary-900 disabled:opacity-50"
                >
                  Apply Template →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};