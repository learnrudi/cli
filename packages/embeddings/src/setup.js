/**
 * Embeddings setup helpers
 *
 * Helps users get a working embedding provider configured.
 */

import { execFileSync } from 'child_process';
import { createOllamaProvider } from './providers/ollama.js';

const EMBEDDING_MODELS = [
  'nomic-embed-text',
  'mxbai-embed-large',
  'all-minilm',
];

/**
 * Check system status for embedding providers
 * @returns {Promise<Object>}
 */
export async function checkProviderStatus() {
  const status = {
    ollama: {
      installed: false,
      running: false,
      models: [],
      embeddingModels: [],
    },
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
    },
  };

  // Check Ollama
  try {
    // Check if ollama binary exists
    try {
      execFileSync('which', ['ollama'], { stdio: 'pipe' });
      status.ollama.installed = true;
    } catch {
      // Not installed
    }

    // Check if server is running
    const ollama = createOllamaProvider();
    status.ollama.running = await ollama.isAvailable();

    // List models if running
    if (status.ollama.running) {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        const data = await response.json();
        status.ollama.models = data.models?.map(m => m.name) || [];
        status.ollama.embeddingModels = status.ollama.models.filter(m =>
          EMBEDDING_MODELS.some(em => m.startsWith(em))
        );
      }
    }
  } catch {
    // Ollama check failed
  }

  return status;
}

/**
 * Get setup instructions based on current status
 * @returns {Promise<string>}
 */
export async function getSetupInstructions() {
  const status = await checkProviderStatus();
  const lines = [];

  lines.push('Embedding Provider Setup\n');

  // Ollama status
  lines.push('Ollama (recommended - free, local):');
  if (!status.ollama.installed) {
    lines.push('  [ ] Install: rudi install ollama');
    lines.push('              or: brew install ollama');
  } else {
    lines.push('  [x] Installed');
  }

  if (status.ollama.installed && !status.ollama.running) {
    lines.push('  [ ] Start server: ollama serve');
  } else if (status.ollama.running) {
    lines.push('  [x] Server running');
  }

  if (status.ollama.running && status.ollama.embeddingModels.length === 0) {
    lines.push('  [ ] Pull embedding model: ollama pull nomic-embed-text');
  } else if (status.ollama.embeddingModels.length > 0) {
    lines.push(`  [x] Embedding models: ${status.ollama.embeddingModels.join(', ')}`);
  }

  lines.push('');

  // OpenAI status
  lines.push('OpenAI (cloud, requires API key):');
  if (status.openai.configured) {
    lines.push('  [x] OPENAI_API_KEY configured');
  } else {
    lines.push('  [ ] Set: export OPENAI_API_KEY=your-key');
  }

  lines.push('');

  // Summary
  if (status.ollama.embeddingModels.length > 0) {
    lines.push('Ready! Use: rudi session index --embeddings');
  } else if (status.openai.configured) {
    lines.push('Ready! Use: rudi session index --embeddings --provider openai');
  } else {
    lines.push('Setup required. Follow the steps above.');
  }

  return lines.join('\n');
}

/**
 * Auto-setup Ollama if possible
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function autoSetupOllama() {
  const status = await checkProviderStatus();

  if (status.ollama.embeddingModels.length > 0) {
    return { success: true, message: 'Ollama already configured with embedding models' };
  }

  if (!status.ollama.installed) {
    return {
      success: false,
      message: 'Ollama not installed. Run: rudi install ollama',
    };
  }

  if (!status.ollama.running) {
    return {
      success: false,
      message: 'Ollama not running. Start with: ollama serve',
    };
  }

  // Pull embedding model
  try {
    console.log('Pulling nomic-embed-text model...');
    execFileSync('ollama', ['pull', 'nomic-embed-text'], { stdio: 'inherit' });
    return { success: true, message: 'Ollama configured with nomic-embed-text' };
  } catch (err) {
    return { success: false, message: `Failed to pull model: ${err.message}` };
  }
}
