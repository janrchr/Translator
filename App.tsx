
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
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    setStatus('Klar');
  }, [stream]);

  const startSession = async () => {
    try {
      setStatus('Lytter...');
      
      // Initialize Audio Contexts (Must be inside user gesture for mobile)
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Explicitly resume for mobile browser compliance
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
      
      // SYSTEM INSTRUCTION updated as per user request
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
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBase64 = encode(new Uint8Array(int16.buffer));
              
              sessionPromise.then((session) => {
                if (session) {
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
            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
              setTranscript(message.serverContent.inputTranscription.text);
            }
            if (message.serverContent?.outputTranscription) {
              setTranslation(message.serverContent.outputTranscription.text);
            }

            // Handle Audio Output
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(ctx.destination);
              
              sourceNode.onended = () => sourcesRef.current.delete(sourceNode);
              sourceNode.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(sourceNode);
              setStatus('Taler...');
            }

            if (message.serverContent?.turnComplete) {
              setStatus('Lytter...');
              // Update History only if there's actual content
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
              sourcesRef.current.forEach(s => {
                try { s.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
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
    <div className="flex flex-col h-screen max-h-screen bg-slate-950">
      {/* Top Bar */}
      <header className="glass p-4 px-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-blue-600'}`}>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              {uiStrings.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-6">
          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{uiStrings.sourceLang}</label>
            <select 
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as Language | 'auto')}
              className="bg-slate-900 border border-slate-800 text-xs sm:text-sm rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 transition-all text-slate-200"
              disabled={isRecording}
            >
              <option value="auto">{uiStrings.auto}</option>
              {Object.entries(Language).map(([key, value]) => (
                <option key={value} value={value}>{key}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{uiStrings.targetLang}</label>
            <select 
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as Language)}
              className="bg-slate-900 border border-slate-800 text-xs sm:text-sm rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500 transition-all text-slate-200"
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
      <main className="flex-1 flex flex-col p-4 sm:p-6 gap-4 sm:gap-6 overflow-hidden">
        
        {/* Visualizer & Status */}
        <div className="glass rounded-3xl p-6 sm:p-8 flex flex-col justify-center items-center relative h-48 sm:h-64 border border-slate-800/50 shadow-2xl">
          <WaveVisualizer isActive={isRecording} stream={stream} />
          <div className="absolute top-4 right-6 flex items-center gap-2 px-3 py-1 bg-slate-950/50 rounded-full border border-slate-800">
             <span className={`w-2 h-2 rounded-full ${status === 'Error' ? 'bg-red-500' : isRecording ? 'bg-green-500' : 'bg-slate-500'}`}></span>
             <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
              {uiStrings.status}: {status}
             </span>
          </div>
          {isRecording && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-blue-400/60 font-medium animate-pulse">
              Live Streaming Active
            </div>
          )}
        </div>

        {/* Transcripts */}
        <div className="flex-1 flex flex-col sm:flex-row gap-4 sm:gap-6 min-h-0">
          <div className="flex-1 glass rounded-3xl p-5 sm:p-6 flex flex-col border border-slate-800/50 overflow-hidden">
            <h3 className="text-xs font-bold text-blue-400/80 mb-3 flex items-center gap-2 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              {uiStrings.heardText}
            </h3>
            <div className="flex-1 overflow-y-auto text-base sm:text-xl leading-relaxed text-slate-300 scrollbar-hide">
              {transcript || <span className="text-slate-600 italic text-sm">Venter på tale...</span>}
            </div>
          </div>

          <div className="flex-1 glass rounded-3xl p-5 sm:p-6 flex flex-col border border-slate-800/50 overflow-hidden">
             <h3 className="text-xs font-bold text-indigo-400/80 mb-3 flex items-center gap-2 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
              {uiStrings.translatedText}
            </h3>
            <div className="flex-1 overflow-y-auto text-base sm:text-xl leading-relaxed text-indigo-100 font-medium scrollbar-hide">
              {translation || <span className="text-slate-600 italic text-sm">Oversættelse dukker op her...</span>}
            </div>
          </div>
        </div>
      </main>

      {/* Floating Control Bar */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 backdrop-blur-xl p-3 rounded-full border border-slate-800 shadow-2xl z-20">
        <button 
          onClick={() => setShowHistory(true)}
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-slate-800/50 text-slate-400 hover:text-white transition-all hover:bg-slate-700"
        >
          <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </button>

        <button 
          onClick={toggleRecording}
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
        >
          {isRecording ? (
            <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          ) : (
            <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          )}
        </button>
        
        <button 
          onClick={() => setGender(prev => prev === 'male' ? 'female' : 'male')}
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center border transition-all ${gender === 'male' ? 'bg-blue-900/20 border-blue-500/50 text-blue-400' : 'bg-pink-900/20 border-pink-500/50 text-pink-400'}`}
        >
           {gender === 'male' ? <span className="text-lg font-bold">♂</span> : <span className="text-lg font-bold">♀</span>}
        </button>
      </div>

      <footer className="p-3 bg-slate-950/80 text-center">
        <div className="text-[9px] text-slate-600 uppercase tracking-[0.2em] font-black">
          Gemini 2.5 Live Native Audio • Real-time Monitoring
        </div>
      </footer>

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex justify-end" onClick={() => setShowHistory(false)}>
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col animate-slide-in shadow-[-20px_0_50px_rgba(0,0,0,0.5)]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {uiStrings.history}
              </h2>
              <button onClick={() => setShowHistory(false)} className="text-slate-500 hover:text-white p-2 rounded-full hover:bg-slate-800 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
              {history.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-50">
                  <p className="text-sm font-medium">Ingen historik endnu</p>
                </div>
              )}
              {history.map((item, idx) => (
                <div key={idx} className="bg-slate-800/40 rounded-2xl p-4 border border-slate-700/30 hover:border-slate-600/50 transition-colors group">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] text-slate-500 font-bold">{item.timestamp.toLocaleTimeString()}</span>
                    <div className="flex gap-1.5">
                       <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-900 text-slate-400 border border-slate-800">{item.sourceLang}</span>
                       <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-800/50">{item.targetLang}</span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 mb-2 leading-relaxed italic group-hover:text-slate-300 transition-colors">"{item.originalText}"</p>
                  <p className="text-sm text-indigo-100 font-semibold leading-relaxed group-hover:text-white transition-colors">{item.translatedText}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default App;
