import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage, UserLocation, User } from '../types/travel';
import { aiAgent } from '../services/aiTravelAgent';
import { getCurrentLocation, describeLocation } from '../services/geolocation';
import { X, Sparkles, Send, MapPin, LogIn } from 'lucide-react';

interface AiChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onRequireAuth: () => void;
}

export const AiChatDrawer: React.FC<AiChatDrawerProps> = ({ isOpen, onClose, currentUser, onRequireAuth }) => {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-welcome',
      sender: 'assistant',
      text: '👋 Hello! I am your **AI Travel Concierge**. Ask me about any destination, or let me build a trip around your current location and interests.',
      timestamp: 'Just now',
      suggestions: [
        'Suggest a weekend getaway from my area',
        'What are unmissable things near me?',
        'Plan a 3-day trip from where I am'
      ]
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      getCurrentLocation().then((loc) => {
        if (loc && !userLocation) {
          setUserLocation(loc);
          const label = describeLocation(loc);
          setMessages((prev) => [
            {
              id: 'msg-welcome',
              sender: 'assistant',
              text: `👋 Hello! I can see you're around **${label}**. Ask me about any destination, get local recommendations near you, or plan a trip from here.`,
              timestamp: 'Just now',
              suggestions: [
                'Best day trips from my location',
                'Top hidden gems near me',
                'Plan a trip from my area with these interests'
              ]
            },
            ...prev.filter((m) => m.id !== 'msg-welcome')
          ]);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
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
      const history = messages
        .filter(m => m.sender !== 'assistant' || m.id !== 'msg-welcome')
        .slice(-14)
        .map(m => ({
          role: m.sender === 'user' ? 'user' as const : 'model' as const,
          text: m.text
        }));
      const assistantMsg = await aiAgent.processChatMessage(prompt, history, userLocation, currentUser);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: `msg-error-${Date.now()}`,
        sender: 'assistant',
        text: err instanceof Error ? err.message : 'The concierge couldn’t respond right now. Please try again.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="drawer-backdrop">
      <div className="drawer-panel">

        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="brand-icon" style={{ width: '38px', height: '38px' }}>
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', margin: 0 }}>AI Travel Concierge</h3>
              <p className="ai-badge-pulse" style={{ fontSize: '0.7rem', color: '#00f2fe', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                {userLocation ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <MapPin className="w-3 h-3" />
                    Grounded on: {userLocation.latitude.toFixed(3)}, {userLocation.longitude.toFixed(3)}
                  </span>
                ) : (
                  'Online & Ready'
                )}
              </p>
            </div>
          </div>

          <button type="button" onClick={onClose} className="btn-icon">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Message Stream */}
        <div className="chat-stream">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-row ${msg.sender === 'user' ? 'user' : ''}`}
            >
              <div className={`chat-bubble ${msg.sender === 'user' ? 'user' : 'ai'}`}>
                {msg.sender === 'user' ? msg.text : (
                  <div className="chat-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>

              <span className="chat-meta">{msg.timestamp}</span>

              {/* Suggestions Chips */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="suggestion-row">
                  {msg.suggestions.map((sug, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => handleSend(sug)}
                      className="suggestion-chip"
                    >
                      💡 {sug}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div className="typing-indicator">
              <span className="typing-dots"><span /><span /><span /></span>
              <span className="typing-label">AI Agent is thinking…</span>
            </div>
          )}

          {!currentUser && (
            <div className="chat-auth-cta">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <LogIn className="w-5 h-5" />
                <span style={{ fontWeight: 700 }}>Sign in to chat with your AI concierge</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                Your agent personalizes recommendations using your name, interests, home city, saved places, and trip plans.
              </p>
              <button
                type="button"
                onClick={onRequireAuth}
                className="btn-primary"
                style={{ marginTop: '0.7rem', padding: '0.6rem 1.4rem', width: '100%' }}
              >
                Sign In / Create Account
              </button>
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
        >
          <div className="chat-input-wrap">
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Ask travel question or itinerary idea..."
              className="form-input"
            />
            <button
              type="submit"
              disabled={!inputPrompt.trim() || isTyping}
              className="btn-primary chat-send"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
