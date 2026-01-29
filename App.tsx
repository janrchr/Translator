
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Language, Gender, HistoryItem, AppStatus } from './types';
import { TRANSLATIONS, LANGUAGE_NAMES } from './constants';
import WaveVisualizer from './components/WaveVisualizer';

// --- Utilities for Audio Processing ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  // UI State
  const [sourceLang, setSourceLang] = useState<Language | 'auto'>('auto');
  const [targetLang, setTargetLang] = useState<Language>(Language.English);
  const [gender, setGender] = useState<Gender>('male');
  const [status, setStatus] = useState<AppStatus>('Klar');
  const [isRecording, setIsRecording] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Audio/Text State
  const [transcript, setTranscript] = useState('');
  const [translation, setTranslation] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // References for Live API
  const sessionRef = useRef<any>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const uiStrings = TRANSLATIONS[targetLang];

  const stopSession = useCallback(() => {
    setIsRecording(false);
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (inputAudioContextRef.current) {
      try { inputAudioContextRef.current.close(); } catch(e) {}
      inputAudioContextRef.current = null;
    }
    setStatus('Klar');
  }, [stream]);

  const startSession = async () => {
    try {
      setStatus('Lytter...');
      
      // Initialize Audio Contexts with explicit sample rates for mobile consistency
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Mobile browsers REQUIRE resume() within a user-initiated event (like this click)
      await inputCtx.resume();
      await outputCtx.resume();
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      setStream(mediaStream);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const voiceName = gender === 'male' ? 'Zephyr' : 'Kore';
      
      const systemInstruction = `Overvåg kontinuerligt inputtet. 
      Din opgave er at være en øjeblikkelig oversætter til ${LANGUAGE_NAMES[targetLang]}.
      Så snart du registrerer et sprog eller tale, der IKKE er ${LANGUAGE_NAMES[targetLang]}, skal du påbegynde en øjeblikkelig oversættelse til ${LANGUAGE_NAMES[targetLang]}.
      
      Regler:
      1. Output KUN den oversatte tale. Ingen forklaringer eller introduktioner.
      2. Hvis inputtet allerede er ${LANGUAGE_NAMES[targetLang]}, skal du forblive tavs.
      3. Forbliv i "lytte-tilstand" konstant. 
      4. Kildesproget er primært ${sourceLang === 'auto' ? 'automatisk detekteret' : LANGUAGE_NAMES[sourceLang as Language]}.
      5. Lever oversættelsen med naturlig intonation.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsRecording(true);
            const source = inputCtx.createMediaStreamSource(mediaStream);
            // ScriptProcessor is older but more broadly compatible on mobile than AudioWorklets in some quick implementations
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              // Only send if session is alive and context is running
              if (inputCtx.state !== 'running') return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBase64 = encode(new Uint8Array(int16.buffer));
              
              sessionPromise.then((session) => {
                if (session && session.sendRealtimeInput) {
                  session.sendRealtimeInput({ 
                    media: { data: pcmBase64, mimeType: 'audio/pcm;rate=16000' } 
                  });
                }
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Check for transcription
            if (message.serverContent?.inputTranscription) {
              setTranscript(message.serverContent.inputTranscription.text);
            }
            if (message.serverContent?.outputTranscription) {
              setTranslation(message.serverContent.outputTranscription.text);
            }

            // Audio processing
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              
              // Ensure context is still running (iOS can suspend it)
              if (ctx.state === 'suspended') await ctx.resume();
              
              const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(ctx.destination);
              
              // Schedule playback
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              sourceNode.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              
              sourceNode.onended = () => {
                sourcesRef.current.delete(sourceNode);
                if (sourcesRef.current.size === 0) setStatus('Lytter...');
              };
              sourcesRef.current.add(sourceNode);
              setStatus('Taler...');
            }

            if (message.serverContent?.turnComplete) {
              if (transcript && translation) {
                setHistory(prev => [{
                  timestamp: new Date(),
                  originalText: transcript,
                  translatedText: translation,
                  sourceLang: sourceLang === 'auto' ? 'Auto' : LANGUAGE_NAMES[sourceLang as Language],
                  targetLang: LANGUAGE_NAMES[targetLang]
                }, ...prev]);
              }
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setStatus('Lytter...');
            }
          },
          onclose: () => stopSession(),
          onerror: (e) => {
            console.error("Live API Error:", e);
            setStatus('Error');
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err) {
      console.error('Failed to start Live session:', err);
      setStatus('Error');
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopSession();
    else startSession();
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="glass p-4 px-6 flex items-center justify-between z-10 shadow-lg">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-red-600 scale-110 shadow-[0_0_20px_rgba(220,38,38,0.5)]' : 'bg-blue-600 shadow-lg'}`}>
            <svg className={`w-6 h-6 text-white ${isRecording ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div className="hidden xs:block">
            <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              {uiStrings.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <label className="text-[8px] uppercase tracking-tighter text-slate-500 font-bold ml-1">Fra</label>
            <select 
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as Language | 'auto')}
              className="bg-slate-900 border border-slate-800 text-[10px] sm:text-xs rounded-md px-2 py-1 outline-none text-slate-300"
              disabled={isRecording}
            >
              <option value="auto">Auto</option>
              {Object.entries(Language).map(([key, value]) => (
                <option key={value} value={value}>{key}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[8px] uppercase tracking-tighter text-slate-500 font-bold ml-1">Til</label>
            <select 
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as Language)}
              className="bg-slate-900 border border-slate-800 text-[10px] sm:text-xs rounded-md px-2 py-1 outline-none text-slate-300"
              disabled={isRecording}
            >
              {Object.entries(Language).map(([key, value]) => (
                <option key={value} value={value}>{key}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden relative">
        
        {/* Visualizer & Status */}
        <div className="glass rounded-2xl p-4 sm:p-6 flex flex-col justify-center items-center relative h-32 sm:h-48 border border-slate-800/50">
          <WaveVisualizer isActive={isRecording} stream={stream} />
          <div className="absolute top-2 right-4 flex items-center gap-1.5 px-2 py-0.5 bg-black/40 rounded-full border border-slate-800">
             <span className={`w-1.5 h-1.5 rounded-full ${status === 'Error' ? 'bg-red-500' : isRecording ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></span>
             <span className="text-[9px] text-slate-400 font-black uppercase">
              {status}
             </span>
          </div>
        </div>

        {/* Real-time Text Blocks */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <div className="flex-1 glass rounded-2xl p-4 border border-slate-800/50 flex flex-col min-h-0">
            <h3 className="text-[10px] font-black text-blue-500 mb-2 uppercase tracking-[0.2em] flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-blue-500 shadow-[0_0_5px_blue]"></span>
              Input
            </h3>
            <div className="flex-1 overflow-y-auto text-base sm:text-lg text-slate-300 scroll-smooth scrollbar-hide">
              {transcript || <span className="text-slate-700 italic text-sm">Venter på lyd...</span>}
            </div>
          </div>

          <div className="flex-1 glass rounded-2xl p-4 border border-indigo-900/30 flex flex-col min-h-0 bg-indigo-950/5">
             <h3 className="text-[10px] font-black text-indigo-400 mb-2 uppercase tracking-[0.2em] flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_5px_indigo]"></span>
              Oversættelse
            </h3>
            <div className="flex-1 overflow-y-auto text-base sm:text-lg text-indigo-100 font-medium scroll-smooth scrollbar-hide">
              {translation || <span className="text-slate-700 italic text-sm">Oversættelse vises her...</span>}
            </div>
          </div>
        </div>

        {/* Floating Controls */}
        <div className="flex items-center justify-center gap-6 pb-6 pt-2">
          <button 
            onClick={() => setShowHistory(true)}
            className="w-12 h-12 rounded-full flex items-center justify-center bg-slate-900/50 border border-slate-800 text-slate-400 active:scale-90 transition-transform"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>

          <button 
            onClick={toggleRecording}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 ${isRecording ? 'bg-red-600 hover:bg-red-700 scale-105' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'} text-white border-4 border-slate-950`}
          >
            {isRecording ? (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            ) : (
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            )}
          </button>
          
          <button 
            onClick={() => setGender(prev => prev === 'male' ? 'female' : 'male')}
            className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all active:scale-90 ${gender === 'male' ? 'bg-blue-900/20 border-blue-500/50 text-blue-400' : 'bg-pink-900/20 border-pink-500/50 text-pink-400'}`}
          >
             <span className="text-xl font-bold">{gender === 'male' ? '♂' : '♀'}</span>
          </button>
        </div>
      </main>

      {/* History Drawer */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex justify-end" onClick={() => setShowHistory(false)}>
          <div className="w-full max-w-sm bg-slate-900 h-full flex flex-col animate-slide-in shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                Historik
              </h2>
              <button onClick={() => setShowHistory(false)} className="text-slate-500 hover:text-white p-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
              {history.map((item, idx) => (
                <div key={idx} className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] text-slate-500 font-black uppercase">{item.timestamp.toLocaleTimeString()}</span>
                    <span className="text-[9px] px-2 py-0.5 rounded-md bg-blue-900/30 text-blue-300 border border-blue-800/50">{item.targetLang}</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-1 leading-relaxed">"{item.originalText}"</p>
                  <p className="text-sm text-indigo-100 font-bold leading-relaxed">{item.translatedText}</p>
                </div>
              ))}
              {history.length === 0 && <p className="text-center text-slate-600 mt-10 text-sm">Ingen historik endnu</p>}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        xs: { min-width: 400px; }
      `}</style>
    </div>
  );
};

export default App;
