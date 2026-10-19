Yes, make Command Center's error message tell me to restart Ollama when the local model engine crashes like this.

---

Note (added when saving): "like this" refers to Ollama answering HTTP 500 ("llama-server chat error: Compute error") after a Metal GPU failure on an 8 GB Mac; the engine stays broken until it is restarted (`ollama stop <model>` or quitting Ollama).
