import { pipeline, env } from '@huggingface/transformers';

// Configure transformers to use WASM backend and not load local models
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1; // Basic web compatibility

class PipelineSingleton {
  static task = 'depth-estimation';
  static model = 'onnx-community/depth-anything-v2-small';
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, {
        progress_callback,
        device: 'webgpu' // try webgpu first
      }).catch(err => {
        console.warn('WebGPU failed, falling back to WASM', err);
        return pipeline(this.task, this.model, {
          progress_callback,
          device: 'wasm'
        });
      });
    }
    return this.instance;
  }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
  const { imageUrl, type } = event.data;

  if (type === 'load') {
    self.postMessage({ status: 'loading', step: 'Initializing ML model...' });
    try {
      await PipelineSingleton.getInstance(x => {
        self.postMessage({ status: 'progress', data: x });
      });
      self.postMessage({ status: 'ready' });
    } catch (e) {
      self.postMessage({ status: 'error', error: e.message });
    }
    return;
  }

  if (type === 'predict') {
    self.postMessage({ status: 'processing', step: 'Depth Extraction' });
    try {
      const estimator = await PipelineSingleton.getInstance();
      
      const result = await estimator(imageUrl);
      
      // result contains:
      // depth: a RawImage of size [height, width] containing the depth map
      // predicted_depth: tensor
      
      // We'll return the raw image buffer to be turned into a Data URI or parsed
      const { depth } = result;
      
      // Post back the image dimensions and raw pixel data
      self.postMessage({
        status: 'complete',
        result: {
          width: depth.width,
          height: depth.height,
          data: depth.data, // Uint8Array or Float32Array depending on model
        }
      });
    } catch (error) {
      self.postMessage({ status: 'error', error: error.message });
    }
  }
});
