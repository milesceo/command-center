import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Component workshop for Geeked. Every UI piece with a story can be viewed in isolation, in both
 * themes, with every palette, density and animation level from the toolbar, and the MCP addon
 * lets Claude list components and read their stories (see docs/design-tools.md).
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-mcp'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (config) => ({
    ...config,
    // The app's own config pins the Tauri dev port (1420, strict); Storybook picks its own.
    server: { ...config.server, port: undefined, strictPort: false },
  }),
};

export default config;
