import { InjectionToken } from '@angular/core';
import { Feedback, AddedWord } from './entities/feedback';

export interface IFeedbackService {
  sendFeedback(feedback: Feedback): Promise<any>;
  addWord(word: AddedWord): Promise<any>;
}

export const FEEDBACK_SERVICE = new InjectionToken<IFeedbackService>('Feedback service');
export const FEEDBACK_CONFIG = new InjectionToken<any>('Feedback service config');
