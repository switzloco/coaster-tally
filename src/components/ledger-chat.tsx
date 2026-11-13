'use client';

import React, { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { ChatSession } from '@/lib/food-exercise-types';
import { collection, orderBy, query, limit } from 'firebase/firestore';
import { useTranscription } from '@/hooks/use-transcription';
import { useToast } from '@/hooks/use-toast';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';

interface TurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_PROMPTS = [
  'How does my 7-day rolling average compare to last month?',
  'Which days of the week are my heaviest pours?',
  'How many Clear Days have I logged in the last 30 days?',
  'Suggest 3 zero-proof swaps for Friday evenings',
];

function getLocalDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function LedgerChat() {
  const { user } = useUser();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const listEndRef = useRef<HTMLDivElement | null>(null);

  const handleVoiceTranscript = React.useCallback((text: string) => {
    if (text?.trim()) {
      setInput((prev) => (prev ? `${prev.trim()} ${text.trim()}` : text.trim()));
    }
  }, []);

  const {
    status: voiceStatus,
    startRecording,
    stopRecording,
  } = useTranscription(
    handleVoiceTranscript,
    user ? () => user.getIdToken() : undefined
  );

  const isRecording = voiceStatus === 'recording';
  const isTranscribing = voiceStatus === 'transcribing';

  const handleSend = async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || isStreaming) return;

    if (!overrideText) setInput('');
    const nextHistory: TurnMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages([...nextHistory, { role: 'assistant', content: '' }]);
    setIsStreaming(true);

    try {
      const token = user ? await user.getIdToken() : '';
      const res = await fetch('/api/ledger-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: trimmed,
          chatHistory: messages.map((m) => ({ role: m.role, content: m.content })),
          userName: user?.displayName || 'Friend',
          localDate: getLocalDateStr(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload?.error || 'Could not reach Sunny.');
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const text = await res.text();
        setMessages([...nextHistory, { role: 'assistant', content: text }]);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          if (copy.length > 0) {
            copy[copy.length - 1] = { role: 'assistant', content: accumulated };
          }
          return copy;
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went sideways asking Sunny.';
      toast({
        variant: 'destructive',
        title: 'Ledger Q&A unavailable',
        description: msg,
      });
      setMessages(nextHistory);
    } finally {
      setIsStreaming(false);
      setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  };

  return (
    <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
      <CardHeader
        onClick={() => setIsOpen((prev) => !prev)}
        className="cursor-pointer select-none py-4 px-5 flex flex-row items-center justify-between gap-3 hover:bg-[#FAF6F0]/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-full bg-[#C26D2D]/15 border border-[#C26D2D]/25 flex items-center justify-center text-[#C26D2D] shrink-0">
            <Sparkles className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base font-bold text-[#1F1B18]">
              Ask Sunny About Your History
            </CardTitle>
            <CardDescription className="text-xs text-[#6E6359] truncate">
              Query patterns across weeks, Clear Days, weekday vs weekend pace, or swap ideas.
            </CardDescription>
          </div>
        </div>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={isOpen ? 'Collapse Sunny Q&A' : 'Expand Sunny Q&A'}
          className="text-[#6E6359] shrink-0"
        >
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </CardHeader>

      {isOpen && (
        <CardContent className="pt-2 pb-5 px-5 border-t border-[#E8DFD1]/70 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-2.5 pt-2">
              <p className="text-xs text-[#6E6359]">
                Pick a question to inspect your logged pours, or ask anything in your own words:
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => handleSend(prompt)}
                    className="text-left px-3 py-1.5 rounded-full bg-[#FAF6F0] border border-[#E8DFD1] hover:border-[#C26D2D] text-xs font-medium text-[#1F1B18] transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1 pt-2">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#1F1B18] text-[#FAF6F0]'
                        : 'bg-[#FAF6F0] border border-[#E8DFD1] text-[#1F1B18]'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      msg.content ? (
                        <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 text-[#1F1B18]">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[#6E6359]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Sunny is checking your coaster...
                        </span>
                      )
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 pt-1"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isStreaming}
              placeholder="Ask about a week, Clear Days, or drink swap..."
              className="h-10 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={isStreaming || isTranscribing}
              onClick={isRecording ? stopRecording : startRecording}
              aria-label={isRecording ? 'Stop voice note' : 'Record voice question'}
              className={`h-10 w-10 shrink-0 border-[#E8DFD1] ${
                isRecording ? 'bg-[#C26D2D] text-white border-[#C26D2D]' : 'bg-[#FFFDF9]'
              }`}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="h-10 px-4 bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] shrink-0"
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
            {messages.length > 0 && !isStreaming && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setMessages([])}
                aria-label="Clear Q&A transcript"
                className="h-10 w-10 text-[#6E6359] shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </form>
        </CardContent>
      )}
    </Card>
  );
}

export function ChatHistoryLog() {
  const { user } = useUser();
  const db = useFirestore();
  const [expanded, setExpanded] = useState(false);

  const sessionsQuery = useMemoFirebase(() => {
    if (!user || !db) return null;
    return query(
      collection(db, 'users', user.uid, 'chat_sessions'),
      orderBy('date', 'desc'),
      limit(14)
    );
  }, [user, db]);

  const { data: sessions } = useCollection<ChatSession>(sessionsQuery);

  const recentSessions = useMemo(
    () => (sessions ?? []).filter((s) => (s.messages?.length ?? 0) > 0),
    [sessions]
  );

  if (recentSessions.length === 0) return null;

  return (
    <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
      <CardHeader
        onClick={() => setExpanded((prev) => !prev)}
        className="cursor-pointer select-none py-3.5 px-5 flex flex-row items-center justify-between gap-3 hover:bg-[#FAF6F0]/60 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <MessageSquareText className="w-4 h-4 text-[#C26D2D]" />
          <div>
            <CardTitle className="text-sm font-bold text-[#1F1B18]">
              Recent Booth Notes ({recentSessions.length})
            </CardTitle>
            <CardDescription className="text-xs text-[#6E6359]">
              Saved conversations with Sunny by date.
            </CardDescription>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-[#6E6359]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#6E6359]" />
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-2 pb-4 px-5 border-t border-[#E8DFD1]/70 space-y-3">
          {recentSessions.map((session) => (
            <div
              key={session.id}
              className="rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] p-3 space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#1F1B18]">{session.date}</span>
                <span className="text-[#6E6359]">
                  {session.messages?.length ?? 0} messages
                </span>
              </div>
              {session.messages?.slice(-2).map((m, idx) => (
                <p key={idx} className="text-xs text-[#6E6359] line-clamp-2">
                  <strong className="text-[#1F1B18]">
                    {m.role === 'user' ? 'You' : 'Sunny'}:
                  </strong>{' '}
                  {m.content}
                </p>
              ))}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
