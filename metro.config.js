const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const threePath = path.join(__dirname, 'node_modules/three');

// three.js on react-native-webgpu: every `three` import must resolve to the WebGPU build,
// including bare `three` imports made by addons.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three' || moduleName === 'three/webgpu') {
    return { filePath: path.join(threePath, 'build/three.webgpu.js'), type: 'sourceFile' };
  }
  if (moduleName === 'three/tsl') {
    return { filePath: path.join(threePath, 'build/three.tsl.js'), type: 'sourceFile' };
  }
  if (moduleName.startsWith('three/addons/')) {
    return {
      filePath: path.join(threePath, 'examples/jsm', moduleName.replace('three/addons/', '')),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
