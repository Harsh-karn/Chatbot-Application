import React from 'react';
import { Plus, Trash2, MessageSquare, Settings2, Sparkles, BrainCircuit } from 'lucide-react';

export interface Conversation {
  id: string;
  title: string;
  status: 'active' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  provider: string;
  setProvider: (val: string) => void;
  model: string;
  setModel: (val: string) => void;
  view: 'chat' | 'stats';
}

const PROVIDERS = [
  { id: 'google', name: 'Google Gemini' },
  { id: 'openai', name: 'OpenAI GPT' },
  { id: 'anthropic', name: 'Anthropic Claude' },
  { id: 'deepseek', name: 'DeepSeek AI' },
];

const MODELS: Record<string, { id: string; name: string }[]> = {
  google: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o (Simulated)' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
  ],
  deepseek: [
    { id: 'deepseek-coder', name: 'DeepSeek Coder V2' },
  ],
};

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  provider,
  setProvider,
  model,
  setModel,
  view,
}) => {
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProv = e.target.value;
    setProvider(nextProv);
    // Set default model for the selected provider
    if (MODELS[nextProv] && MODELS[nextProv].length > 0) {
      setModel(MODELS[nextProv][0].id);
    }
  };

  return (
    <aside className="sidebar">
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <BrainCircuit size={20} color="#8b5cf6" />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#a78bfa' }}>
            Inference Lab
          </span>
        </div>
        <button className="btn-new-chat" onClick={onCreate} disabled={view !== 'chat'}>
          <Plus size={16} />
          New Conversation
        </button>
      </div>

      {/* Conversation Thread Selector */}
      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.82rem', marginTop: '20px' }}>
            No conversation history.
          </div>
        ) : (
          conversations.map((convo) => (
            <div
              key={convo.id}
              className={`conversation-item ${activeId === convo.id ? 'active' : ''}`}
              onClick={() => view === 'chat' && onSelect(convo.id)}
              style={{ opacity: view !== 'chat' ? 0.5 : 1, cursor: view !== 'chat' ? 'not-allowed' : 'pointer' }}
            >
              <div className="conversation-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MessageSquare size={14} style={{ flexShrink: 0 }} />
                  <span className="conversation-title">{convo.title}</span>
                </div>
                <div className="conversation-meta">
                  <span>{new Date(convo.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`status-badge ${convo.status}`}>
                    {convo.status}
                  </span>
                </div>
              </div>
              <button
                className="btn-delete-convo"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(convo.id, e);
                }}
                title="Delete Session"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Model & Config Selector Panels */}
      <div className="settings-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', color: '#e5e7eb' }}>
          <Settings2 size={15} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>Parameters</span>
        </div>

        <div className="settings-group">
          <label>LLM Provider</label>
          <select className="settings-select" value={provider} onChange={handleProviderChange}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-group">
          <label>Inference Model</label>
          <select className="settings-select" value={model} onChange={(e) => setModel(e.target.value)}>
            {(MODELS[provider] || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '0.72rem', color: '#6b7280' }}>
          <Sparkles size={11} color="#06b6d4" />
          <span>SDK Logging Enabled (SSE)</span>
        </div>
      </div>
    </aside>
  );
};
