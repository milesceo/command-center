// Tests never touch the network: a fetch that a test did not stub fails fast.
globalThis.fetch = () => Promise.reject(new Error('The network is disabled in tests.'));
