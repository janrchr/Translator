
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Language, Gender, HistoryItem, AppStatus } from './types';
import { TRANSLATIONS, LANGUAGE_NAMES } from './constants';
import WaveVisualizer from './components/WaveVisualizer';
import { translateText } from './services/geminiService';

const App: React.FC = () => {
  // UI State
  const [sourceLang, setSourceLang] = useState<Language | 'auto'>('auto');
  const [targetLang, setTargetLang] = useState<Language>(Language.English);
  const [gender, setGender] = useState<Gender>('male');
  const [model, setModel] = useState('gemini-3-flash-preview');
  const [status, setStatus] = useState<AppStatus>('Klar');
  const [isRecording, setIsRecording] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Audio/Text State
  const [transcript, setTranscript] = useState('');
  const [translation, setTranslation] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // References
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(window.speechSynthesis);
  const uiStrings = TRANSLATIONS[targetLang];

  // Restart recognition if language changes while recording
  useEffect(() => {
    if (isRecording) {
      stopListening();
      startListening();
    }
  }, [sourceLang]);

  // Handle TTS Queue
  const speak = useCallback((text: string) => {
    if (!synthesisRef.current || !text) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLang;
    
    // Attempt to pick a voice matching the gender/language
    const voices = synthesisRef.current.getVoices();
    const voice = voices.find(v => 
      v.lang.startsWith(targetLang.split('-')[0]) && 
      (gender === 'male' ? v.name.toLowerCase().includes('male') : v.name.toLowerCase().includes('female'))
    ) || voices.find(v => v.lang.startsWith(targetLang.split('-')[0]));
    
    if (voice) utterance.voice = voice;
    
    utterance.onstart = () => setStatus('Taler...');
    utterance.onend = () => setStatus('Lytter...');
    
    synthesisRef.current.speak(utterance);
  }, [targetLang, gender]);

  // Setup Speech Recognition (Full-Duplex)
  const startListening = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } 
      });
      setStream(mediaStream);

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Your browser does not support Speech Recognition.");
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      // Set recognition language. If auto, default to browser language or empty string
      recognition.lang = sourceLang === 'auto' ? '' : sourceLang;

      recognition.onstart = () => {
        setIsRecording(true);
        setStatus('Lytter...');
      };

      recognition.onresult = async (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (interimTranscript) setTranscript(interimTranscript);

        if (finalTranscript) {
          setTranscript(finalTranscript);
          setStatus('Oversætter...');
          
          const translated = await translateText(finalTranscript, LANGUAGE_NAMES[targetLang], model);
          setTranslation(translated);
          
          const newHistoryItem: HistoryItem = {
            timestamp: new Date(),
            originalText: finalTranscript,
            translatedText: translated,
            sourceLang: sourceLang === 'auto' ? 'Auto-detected' : LANGUAGE_NAMES[sourceLang],
            targetLang: LANGUAGE_NAMES[targetLang]
          };
          setHistory(prev => [newHistoryItem, ...prev]);
          
          speak(translated);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Recognition error', event.error);
        setStatus('Error');
        if (event.error === 'no-speech') {
            recognition.stop();
            setTimeout(() => {
                if (isRecording) recognition.start();
            }, 100);
        }
      };

      recognition.onend = () => {
        if (isRecording) {
            try {
                recognition.start();
            } catch (e) {
                console.warn('Could not restart recognition automatically', e);
            }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();

    } catch (err) {
      console.error('Failed to get microphone access', err);
      setStatus('Error');
    }
  };

  const stopListening = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setStatus('Klar');
    if (synthesisRef.current) synthesisRef.current.cancel();
  };

  const toggleRecording = () => {
    if (isRecording) stopListening();
    else startListening();
  };

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Top Bar */}
      <header className="glass p-4 px-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center animate-pulse">
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

        <div className="flex items-center gap-4 sm:gap-8">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-slate-400">{uiStrings.sourceLang}</label>
            <select 
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as Language | 'auto')}
              className="bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-1 outline-none hover:border-blue-500 transition-colors"
            >
              <option value="auto">{uiStrings.auto}</option>
              {Object.entries(Language).map(([key, value]) => (
                <option key={value} value={value}>{key}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-slate-400">{uiStrings.targetLang}</label>
            <select 
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as Language)}
              className="bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-1 outline-none hover:border-blue-500 transition-colors"
            >
              {Object.entries(Language).map(([key, value]) => (
                <option key={value} value={value}>{key}</option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-slate-400">{uiStrings.gender}</label>
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
              <button 
                onClick={() => setGender('male')}
                className={`px-3 py-0.5 text-xs rounded-md transition-all ${gender === 'male' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {uiStrings.male}
              </button>
              <button 
                onClick={() => setGender('female')}
                className={`px-3 py-0.5 text-xs rounded-md transition-all ${gender === 'female' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {uiStrings.female}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row p-6 gap-6 overflow-hidden">
        
        {/* Left Side: Waveform & Status */}
        <div className="flex-1 flex flex-col gap-6">
          <div className="glass rounded-3xl p-8 flex flex-col justify-center items-center relative h-64 border-2 border-slate-800">
            <WaveVisualizer isActive={isRecording} stream={stream} />
            <div className="absolute top-4 right-6 flex items-center gap-2">
               <span className={`w-2 h-2 rounded-full ${status === 'Error' ? 'bg-red-500' : isRecording ? 'bg-green-500' : 'bg-slate-500'}`}></span>
               <span className="text-xs text-slate-400 font-medium uppercase tracking-tighter">
                {uiStrings.status}: {status}
               </span>
            </div>
          </div>

          <div className="flex-1 flex flex-col md:flex-row gap-6">
            {/* Split View - Source */}
            <div className="flex-1 glass rounded-3xl p-6 flex flex-col border border-slate-800">
              <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"></path></svg>
                {uiStrings.heardText}
              </h3>
              <div className="flex-1 overflow-y-auto text-lg leading-relaxed text-slate-300">
                {transcript || <span className="text-slate-600 italic">Start speaking...</span>}
              </div>
            </div>

            {/* Split View - Translated */}
            <div className="flex-1 glass rounded-3xl p-6 flex flex-col border border-slate-800">
               <h3 className="text-sm font-semibold text-indigo-400 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 5h12M9 3v2m1.048 9.5a18.022 18.022 0 01-3.827-5.802h2.779c.143 0 .285-.01.425-.03m-2.11 5.833c.451.988 1.05 1.884 1.77 2.667m4.24-5.833H16c1.105 0 2 .895 2 2v2m-6 3l1.5 3L11 21"></path></svg>
                {uiStrings.translatedText}
              </h3>
              <div className="flex-1 overflow-y-auto text-lg leading-relaxed text-indigo-100 font-medium">
                {translation || <span className="text-slate-600 italic">Translation will appear here...</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Floating Sidebar Controls */}
        <div className="w-full md:w-24 flex md:flex-col items-center justify-center gap-4 bg-slate-900/40 p-4 rounded-3xl border border-slate-800">
          <button 
            onClick={toggleRecording}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 ${isRecording ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
          >
            {isRecording ? (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            ) : (
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            )}
          </button>
          
          <button 
            onClick={() => setShowHistory(true)}
            className="w-12 h-12 rounded-2xl flex items-center justify-center bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-all"
            title={uiStrings.history}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
      </main>

      {/* Footer Settings */}
      <footer className="glass p-3 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400">{uiStrings.model}:</label>
          <select 
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer hover:text-blue-400 transition-colors"
          >
            <option value="gemini-3-flash-preview" className="bg-slate-800">Gemini 3 Flash</option>
            <option value="gemini-3-pro-preview" className="bg-slate-800">Gemini 3 Pro</option>
          </select>
        </div>
        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
          Powered by Gemini AI Engine
        </div>
      </footer>

      {/* History Modal/Drawer */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-700 h-full flex flex-col animate-slide-in">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {uiStrings.history}
              </h2>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-white p-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4">
                  <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  <p>No history yet. Start a conversation!</p>
                </div>
              ) : (
                history.map((item, idx) => (
                  <div key={idx} className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-slate-500">{item.timestamp.toLocaleTimeString()}</span>
                      <div className="flex gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600">{item.sourceLang}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-800">{item.targetLang}</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-400 mb-2 italic">"{item.originalText}"</p>
                    <p className="text-sm text-indigo-100 font-medium">{item.translatedText}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
};

export default App;
