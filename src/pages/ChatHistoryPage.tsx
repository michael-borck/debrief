import React, { useState, useEffect } from 'react';
import { MessageCircle, Search, Clock, Trash2, ChevronRight, FileText, FolderOpen } from 'lucide-react';
import { formatDistanceToNow } from '../utils/helpers';
import { TranscriptChatModal } from '../components/TranscriptChatModal';
import { Transcript } from '../types';

interface ChatConversation {
  id: string;
  transcript_id?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message?: string;
  entity_title?: string;
  entity_type: 'transcript' | 'project';
}

export const ChatHistoryPage: React.FC = () => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { filterConversations(); }, [searchQuery, conversations]);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const conversationsData = await window.electronAPI.db.chat.listConversationsWithMeta();
      setConversations(conversationsData);
    } catch (error) { console.error('Failed to load conversations:', error); }
    finally { setLoading(false); }
  };

  const filterConversations = () => {
    if (!searchQuery.trim()) { setFilteredConversations(conversations); return; }
    const query = searchQuery.toLowerCase();
    setFilteredConversations(conversations.filter(conv =>
      conv.entity_title?.toLowerCase().includes(query) || conv.last_message?.toLowerCase().includes(query)
    ));
  };

  const handleContinueChat = async (conversation: ChatConversation) => {
    if (conversation.entity_type === 'transcript' && conversation.transcript_id) {
      const transcript = await window.electronAPI.db.transcripts.get(conversation.transcript_id);
      if (transcript) {
        transcript.action_items = transcript.action_items ? JSON.parse(transcript.action_items) : [];
        transcript.key_topics = transcript.key_topics ? JSON.parse(transcript.key_topics) : [];
        transcript.tags = transcript.tags ? JSON.parse(transcript.tags) : [];
        setSelectedTranscript(transcript);
        setSelectedConversationId(conversation.id);
        setShowChatModal(true);
      }
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await window.electronAPI.db.chat.deleteConversation(conversationId);
      await window.electronAPI.database.run('DELETE FROM project_chat_conversations WHERE id = ?', [conversationId]);
      await loadConversations();
    } catch (error) { console.error('Failed to delete conversation:', error); alert('Failed to delete conversation.'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-surface-400 text-sm">Loading chat history...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="mb-8 animate-fade-in">
        <h1 className="text-2xl font-display text-surface-900 mb-1">Chat History</h1>
        <p className="text-sm text-surface-500">View and continue your conversations with transcripts and projects</p>
      </div>

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-surface-400" size={16} />
          <input type="text" placeholder="Search conversations..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9" />
        </div>
      </div>

      {filteredConversations.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
            <MessageCircle size={28} className="text-surface-300" />
          </div>
          <h3 className="text-base font-display text-surface-700 mb-2">
            {searchQuery ? 'No conversations found' : 'No conversations yet'}
          </h3>
          <p className="text-xs text-surface-400">
            {searchQuery ? 'Try adjusting your search query' : 'Start chatting with a transcript to see history here'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredConversations.map((conversation, i) => (
            <div key={conversation.id}
              className="card-interactive p-5 animate-slide-up" style={{ animationDelay: `${i * 0.03}s`, opacity: 0 }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {conversation.entity_type === 'transcript' ?
                      <FileText size={16} className="text-primary-500 flex-shrink-0" /> :
                      <FolderOpen size={16} className="text-primary-500 flex-shrink-0" />
                    }
                    <h3 className="text-base font-display text-surface-900 truncate">
                      {conversation.entity_title || 'Untitled Conversation'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-surface-400 mb-2">
                    <span className="flex items-center gap-1"><Clock size={12} />{formatDistanceToNow(new Date(conversation.updated_at))} ago</span>
                    <span className="flex items-center gap-1"><MessageCircle size={12} />{conversation.message_count} messages</span>
                    <span className="badge badge-neutral text-[10px] py-0">{conversation.entity_type}</span>
                  </div>
                  {conversation.last_message && (
                    <p className="text-xs text-surface-500 line-clamp-2">Last: {conversation.last_message}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleContinueChat(conversation)}
                  className="btn-primary flex items-center gap-1.5 text-xs py-1.5">
                  Continue <ChevronRight size={13} />
                </button>
                <button onClick={() => handleDeleteConversation(conversation.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTranscript && (
        <TranscriptChatModal transcript={selectedTranscript} isOpen={showChatModal}
          onClose={() => { setShowChatModal(false); setSelectedTranscript(null); setSelectedConversationId(''); loadConversations(); }}
          existingConversationId={selectedConversationId} />
      )}
    </div>
  );
};
