
export enum Language {
  Danish = 'da-DK',
  English = 'en-US',
  German = 'de-DE',
  Turkish = 'tr-TR',
  Japanese = 'ja-JP'
}

export type Gender = 'male' | 'female';

export interface HistoryItem {
  timestamp: Date;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
}

export type AppStatus = 'Klar' | 'Lytter...' | 'Oversætter...' | 'Taler...' | 'Error';

export interface UIStrings {
  title: string;
  sourceLang: string;
  targetLang: string;
  gender: string;
  male: string;
  female: string;
  start: string;
  stop: string;
  detectLang: string;
  history: string;
  heardText: string;
  translatedText: string;
  model: string;
  status: string;
  auto: string;
}
