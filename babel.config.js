module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Compiles `'use gpu'` TypeGPU functions to WGSL at build time
    plugins: ['unplugin-typegpu/babel'],
  };
};
