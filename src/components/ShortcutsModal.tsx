import React, { useState } from 'react';
import { X, Search, Keyboard } from 'lucide-react';
import { Modal } from './Modal';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Only shortcuts that are actually wired. The previous list documented
  // ~40 shortcuts most of which were aspirational. If you wire a new
  // shortcut, add it here too — and if you remove one, take it out.
  const shortcuts = [
    {
      category: 'App',
      items: [
        { keys: ['Ctrl/Cmd', 'O'], description: 'New upload (from File menu)' },
        { keys: ['Ctrl/Cmd', ','], description: 'Open Settings (from File menu)' },
        { keys: ['Ctrl/Cmd', 'Q'], description: 'Quit Debrief' },
        { keys: ['Ctrl/Cmd', '?'], description: 'Show this dialog' },
      ]
    },
    {
      category: 'Modals & Dialogs',
      items: [
        { keys: ['Esc'], description: 'Close the topmost open modal' },
      ]
    },
    {
      category: 'Editing',
      items: [
        { keys: ['Ctrl/Cmd', 'C'], description: 'Copy selected text' },
        { keys: ['Ctrl/Cmd', 'V'], description: 'Paste text' },
        { keys: ['Ctrl/Cmd', 'X'], description: 'Cut selected text' },
        { keys: ['Ctrl/Cmd', 'A'], description: 'Select all text' },
        { keys: ['Ctrl/Cmd', 'Z'], description: 'Undo (in editable fields)' },
      ]
    },
  ];

  const filteredShortcuts = shortcuts.map(category => ({
    ...category,
    items: category.items.filter(item =>
      item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.keys.some(key => key.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  })).filter(category => category.items.length > 0);

  const KeyBadge: React.FC<{ keys: string[] }> = ({ keys }) => (
    <div className="flex items-center space-x-1">
      {keys.map((key, index) => (
        <React.Fragment key={index}>
          <kbd className="px-2 py-1 text-xs font-mono bg-surface-100 border border-surface-200 rounded shadow-card">
            {key}
          </kbd>
          {index < keys.length - 1 && <span className="text-surface-400">+</span>}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Keyboard shortcuts"
      contentClassName="bg-white rounded-lg shadow-elevated max-w-4xl w-full max-h-[90vh] overflow-hidden"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-200 bg-surface-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Keyboard className="w-6 h-6 text-primary-800 mr-2" />
              <h2 className="text-xl font-semibold text-surface-900">Keyboard Shortcuts</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-200 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5 text-surface-500" />
            </button>
          </div>
          
          {/* Search */}
          <div className="mt-4 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-surface-400" />
            </div>
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-surface-200 rounded-lg leading-5 bg-white placeholder-surface-500 focus:outline-none focus:placeholder-surface-400 focus:ring-1 focus:ring-primary-400 focus:border-primary-400 text-sm"
            />
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-140px)] p-6">
          {filteredShortcuts.length === 0 ? (
            <div className="text-center py-8 text-surface-500">
              <Keyboard className="w-12 h-12 mx-auto mb-4 text-surface-300" />
              <p>No shortcuts found matching "{searchTerm}"</p>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredShortcuts.map((category, categoryIndex) => (
                <div key={categoryIndex} className="bg-surface-50 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-surface-900 mb-4 border-b border-surface-200 pb-2">
                    {category.category}
                  </h3>
                  <div className="space-y-3">
                    {category.items.map((item, itemIndex) => (
                      <div key={itemIndex} className="flex items-center justify-between py-2">
                        <span className="text-surface-700 flex-1">{item.description}</span>
                        <KeyBadge keys={item.keys} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-200 bg-surface-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-surface-600">
              <span className="font-medium">{filteredShortcuts.reduce((acc, cat) => acc + cat.items.length, 0)}</span> shortcuts available
            </div>
            <div className="flex items-center space-x-4 text-sm text-surface-500">
              <span>Press <kbd className="px-1 py-0.5 text-xs bg-surface-200 rounded">Esc</kbd> to close</span>
              <span>•</span>
              <span>Press <kbd className="px-1 py-0.5 text-xs bg-surface-200 rounded">Ctrl+?</kbd> anytime to open</span>
            </div>
          </div>
        </div>
      </Modal>
  );
};

export default ShortcutsModal;