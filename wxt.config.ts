import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Web Automation Test',
    description:
      'Record and playback browser automation tests from the Chrome Side Panel.',
    permissions: [
      'sidePanel',
      'storage',
      'scripting',
      'tabs',
      'activeTab',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Web Automation Test',
    },
  },
});
