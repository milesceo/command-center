-- The user's own models (Model Lab): Hugging Face Inference Providers in the cloud, or a model
-- served on this computer by Ollama, llama.cpp, MLX-LM or LM Studio. Settings are presets the
-- app applies to chats with the model; nothing here is a secret (the HF token stays in the OS
-- credential store).
CREATE TABLE custom_models (
  id TEXT PRIMARY KEY,
  -- 'huggingface' | 'local'
  provider TEXT NOT NULL,
  -- The id sent to the server: an HF repo id (optionally with a :provider suffix) or the name a
  -- local server lists.
  model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- The Hugging Face repo it came from, when any.
  hf_repo TEXT,
  -- Local only: 'ollama' | 'llama.cpp' | 'mlx' | 'lmstudio'
  runtime TEXT,
  -- Local only: where the server listens (loopback unless remote servers are allowed).
  base_url TEXT,
  -- GGUF quantisation tag, or NULL.
  quant TEXT,
  -- A model file on this computer, when added from a file.
  file_path TEXT,
  -- MLX only: a LoRA adapter folder.
  adapter_path TEXT,
  system_prompt TEXT,
  -- JSON object: temperature, topP, topK, maxTokens, contextLength, stop, repetitionPenalty.
  params TEXT NOT NULL DEFAULT '{}',
  -- JSON array of strings.
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX custom_models_provider ON custom_models (provider);

-- A chat's own overrides of its Model Lab model's presets (JSON object, same keys as
-- custom_models.params); NULL uses the model's presets unchanged.
ALTER TABLE conversations ADD COLUMN model_params TEXT;
