/**
 * Adopts the UIKit scene-based life cycle, which apps built with the iOS 27 SDK (Xcode 27)
 * require at launch ("UIScene life cycle is required for apps built with this SDK").
 *
 * The SDK 57 bare template still starts React Native from the app delegate. The `expo` package
 * already ships `ExpoAppSceneDelegate` (Obj-C name `EXExpoAppSceneDelegate`), so this plugin:
 * - makes AppDelegate conform to `ExpoReactNativeFactoryProvider`
 * - stops AppDelegate from creating the window (the scene delegate does it)
 * - registers the scene delegate in Info.plist
 *
 * Mirrors what the SDK 58 template does. Remove this plugin after upgrading to SDK 58.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

function withSceneLifecycle(config) {
  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-scene-lifecycle: only Swift AppDelegate is supported');
    }
    let src = cfg.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(
        /class AppDelegate: ExpoAppDelegate \{/,
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
      );
    }
    src = src.replace(
      WINDOW_BLOCK,
      '\n    // The window is created and React Native is started by ExpoAppSceneDelegate.\n'
    );
    cfg.modResults.contents = src;
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

  return config;
}

module.exports = withSceneLifecycle;
