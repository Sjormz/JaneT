import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'JaneT',
  description: 'User guides for the JaneT desktop terminal workspace.',
  base: '/JaneT/',
  outDir: '../../dist/docs',
  appearance: true,
  head: [['meta', { name: 'theme-color', content: '#171b2a' }]],
  themeConfig: {
    logo: '/app-icon.svg',
    siteTitle: 'JaneT Docs',
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Download', link: 'https://github.com/Sjormz/JaneT/releases/latest' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Workspaces and Library', link: '/guide/workspaces' },
        ],
      },
      {
        text: 'Use JaneT',
        items: [
          { text: 'Terminals and panes', link: '/guide/terminals' },
          { text: 'Files and editor', link: '/guide/files-editor' },
          { text: 'Source Control', link: '/guide/source-control' },
          { text: 'Commands and snippets', link: '/guide/commands' },
          { text: 'Agent activity', link: '/guide/agent-activity' },
          { text: 'Settings and notifications', link: '/guide/settings' },
          { text: 'Updates', link: '/guide/updates' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Keyboard shortcuts', link: '/reference/shortcuts' },
          { text: 'Terminal graphics', link: '/reference/terminal-graphics' },
          { text: 'Local data and privacy', link: '/reference/privacy' },
          { text: 'Troubleshooting', link: '/reference/troubleshooting' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Sjormz/JaneT' }],
    editLink: {
      pattern: 'https://github.com/Sjormz/JaneT/edit/main/docs/site/:path',
      text: 'Suggest an edit to this page',
    },
    docFooter: { prev: 'Previous', next: 'Next' },
    outline: { level: [2, 3], label: 'On this page' },
  },
});
