import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;

class PipelineSingleton {
  static task = '';
  static model = '';
  static instance: any = null;

  static async getInstance(progress_callback: Function, task: string = 'summarization', model: string = 'Xenova/distilbart-cnn-6-6') {
    if (this.instance === null || this.task !== task || this.model !== model) {
      this.task = task;
      this.model = model;
      this.instance = pipeline(this.task as any, this.model, { progress_callback });
    }
    return this.instance;
  }
}

self.addEventListener('message', async (event) => {
  const { action, text, source_language, target_language } = event.data;

  try {
    if (action === 'translate') {
      const translator = await PipelineSingleton.getInstance((data: any) => {
        self.postMessage({ status: 'progress', data });
      }, 'translation', 'Xenova/nllb-200-distilled-600M');

      self.postMessage({ status: 'ready' });

      // NLLB expects string input
      const output = await translator(text, {
        src_lang: source_language || 'eng_Latn',
        tgt_lang: target_language || 'spa_Latn',
      });

      self.postMessage({ status: 'complete', result: output[0].translation_text });
    } else {
      // Default to summarize
      const summarizer = await PipelineSingleton.getInstance((data: any) => {
        self.postMessage({ status: 'progress', data });
      });

      self.postMessage({ status: 'ready' });

      const chunk = text ? text.slice(0, 4000) : "";
      const output = await summarizer(chunk, {
        max_new_tokens: 150,
        min_new_tokens: 40,
      });

      self.postMessage({ status: 'complete', result: output[0].summary_text });
    }
  } catch (error: any) {
    self.postMessage({ status: 'error', error: error.message });
  }
});
