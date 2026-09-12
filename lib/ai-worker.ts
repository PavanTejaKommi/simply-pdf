import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;

class PipelineSingleton {
  static task = 'summarization';
  static model = 'Xenova/distilbart-cnn-6-6';
  static instance: any = null;

  static async getInstance(progress_callback: Function) {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, { progress_callback });
    }
    return this.instance;
  }
}

self.addEventListener('message', async (event) => {
  const { text } = event.data;

  try {
    const summarizer = await PipelineSingleton.getInstance((data: any) => {
      self.postMessage({ status: 'progress', data });
    });

    self.postMessage({ status: 'ready' });

    // DistilBART has a token limit, so we take a rough slice to prevent crashes.
    const chunk = text.slice(0, 4000);

    const output = await summarizer(chunk, {
      max_new_tokens: 150,
      min_new_tokens: 40,
    });

    self.postMessage({ status: 'complete', result: output[0].summary_text });
  } catch (error: any) {
    self.postMessage({ status: 'error', error: error.message });
  }
});
