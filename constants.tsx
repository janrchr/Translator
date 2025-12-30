
import { Language, UIStrings } from './types';

export const TRANSLATIONS: Record<Language, UIStrings> = {
  [Language.Danish]: {
    title: 'Gemini Live Oversætter',
    sourceLang: 'Kildesprog',
    targetLang: 'Målsprog',
    gender: 'Stemme køn',
    male: 'Mand',
    female: 'Kvinde',
    start: 'Start Oversættelse',
    stop: 'Stop Oversættelse',
    detectLang: 'Genkend sprog',
    history: 'Samtalelog',
    heardText: 'Hørt tekst',
    translatedText: 'Oversat tekst',
    model: 'AI Model',
    status: 'Status',
    auto: 'Auto-detekter'
  },
  [Language.English]: {
    title: 'Gemini Live Translator',
    sourceLang: 'Source Language',
    targetLang: 'Target Language',
    gender: 'Voice Gender',
    male: 'Male',
    female: 'Female',
    start: 'Start Translation',
    stop: 'Stop Translation',
    detectLang: 'Auto Detect',
    history: 'History Log',
    heardText: 'Heard text',
    translatedText: 'Translated text',
    model: 'AI Model',
    status: 'Status',
    auto: 'Auto-detect'
  },
  [Language.German]: {
    title: 'Gemini Live Übersetzer',
    sourceLang: 'Quellsprache',
    targetLang: 'Zielsprache',
    gender: 'Stimme Geschlecht',
    male: 'Männlich',
    female: 'Weiblich',
    start: 'Übersetzung starten',
    stop: 'Stoppen',
    detectLang: 'Sprache erkennen',
    history: 'Verlauf',
    heardText: 'Gehörter Text',
    translatedText: 'Übersetzter Text',
    model: 'KI Modell',
    status: 'Status',
    auto: 'Automatisch'
  },
  [Language.Turkish]: {
    title: 'Gemini Canlı Çevirmen',
    sourceLang: 'Kaynak Dil',
    targetLang: 'Hedef Dil',
    gender: 'Ses Cinsiyeti',
    male: 'Erkek',
    female: 'Kadın',
    start: 'Çeviriyi Başlat',
    stop: 'Durdur',
    detectLang: 'Dili Algıla',
    history: 'Geçmiş',
    heardText: 'Duyulan metin',
    translatedText: 'Çevrilen metin',
    model: 'Yapay Zeka Modeli',
    status: 'Durum',
    auto: 'Otomatik Algıla'
  },
  [Language.Japanese]: {
    title: 'Gemini リアルタイム翻訳',
    sourceLang: '元の言語',
    targetLang: '対象言語',
    gender: '音声の性別',
    male: '男性',
    female: '女性',
    start: '翻訳開始',
    stop: '停止',
    detectLang: '言語を自動検出',
    history: '履歴',
    heardText: '聞き取ったテキスト',
    translatedText: '翻訳後のテキスト',
    model: 'AI モデル',
    status: 'ステータス',
    auto: '自動検出'
  }
};

export const LANGUAGE_NAMES: Record<Language, string> = {
  [Language.Danish]: 'Dansk',
  [Language.English]: 'English',
  [Language.German]: 'Deutsch',
  [Language.Turkish]: 'Türkçe',
  [Language.Japanese]: '日本語'
};
