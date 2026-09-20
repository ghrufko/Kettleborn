// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web implementation (wa-sqlite) ships a .wasm binary that
// Metro doesn't treat as a bundleable asset by default. This is Expo's
// own documented requirement for using expo-sqlite on web — see
// https://docs.expo.dev/versions/latest/sdk/sqlite/ ("To use expo-sqlite
// on web, you need to configure Metro bundler to support wasm files").
config.resolver.assetExts.push('wasm');

module.exports = config;
