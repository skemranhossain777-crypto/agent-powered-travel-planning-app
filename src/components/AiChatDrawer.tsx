import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types/travel';
import { aiAgent } from '../services/aiTravelAgent';
import { X, Sparkles, Send, Loader2 } from 'lucide-react';

interface AiChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AiChatDrawer: React.FC<AiChatDrawerProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-welcome',
      sender: 'assistant',
      text: '👋 Hello! I am your **AI Travel Concierge**. Ask me anything about destination tips, optimal flight seasons, packing guides, or Tokyo/Kyoto dining recommendations!',
      timestamp: 'Just now',
      suggestions: ['Best 3-day Kyoto itinerary', 'Tell me about Tokyo restaurants', 'What to pack for Europe?']
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const prompt = textToSend || inputPrompt;
    if (!prompt || !prompt.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: prompt.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setIsTyping(true);

    try {
      const assistantMsg = await aiAgent.processChatMessage(prompt);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="drawer-backdrop">
      <div className="drawer-panel">
        
        {/* Header */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="brand-icon" style={{ width: '36px', height: '36px' }}>
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', margin: 0 }}>AI Travel Concierge</h3>
              <p style={{ fontSize: '0.7rem', color: '#00f2fe', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                Online & Ready
              </p>
            </div>
          </div>

          <button type="button" onClick={onClose} className="btn-icon">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Message Stream */}
        <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              <div
                style={{
                  maxWidth: '88%',
                  padding: '0.75rem 1rem',
                  borderRadius: '16px',
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                  background: msg.sender === 'user' ? 'var(--gradient-primary)' : 'rgba(255,255,255,0.05)',
                  border: msg.sender === 'user' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  color: msg.sender === 'user' ? '#040812' : '#f1f5f9',
                  fontWeight: msg.sender === 'user' ? 600 : 400
                }}
              >
                {msg.text}
              </div>

              <span style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.25rem', padding: '0 0.25rem' }}>
                {msg.timestamp}
              </span>

              {/* Suggestions Chips */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxWidth: '90%' }}>
                  {msg.suggestions.map((sug, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => handleSend(sug)}
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '9999px',
                        background: 'rgba(0, 242, 254, 0.1)',
                        border: '1px solid rgba(0, 242, 254, 0.3)',
                        color: '#00f2fe',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      💡 {sug}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#94a3b8' }}>
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              <span>AI Agent is typing response...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={{ padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Ask travel question or itinerary idea..."
              className="form-input"
              style={{ borderRadius: '9999px', paddingRight: '3rem' }}
            />
            <button
              type="submit"
              disabled={!inputPrompt.trim() || isTyping}
              className="btn-primary"
              style={{
                position: 'absolute',
                right: '0.3rem',
                width: '36px',
                height: '36px',
                padding: 0,
                borderRadius: '50%'
              }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
