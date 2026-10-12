// The bridge between BleepBloop's main process and Sparkle, the macOS
// updater pitch.dog's other Mac apps use. It loads Sparkle.framework from the
// app bundle at run time (so nothing links against it at build time), starts
// SPUStandardUpdaterController, and exposes three calls to JavaScript:
//
//   start()      → true when the updater is running
//   check()      → "Check for Updates…": Sparkle's own window and progress
//   canCheck()   → false while a check or install is already under way
//
// Updates are trusted by their EdDSA signature against SUPublicEDKey in
// Info.plist, not by Apple code signing, so an ad-hoc signed app can use it.
//
// Release-testing hooks, the same as pitch.dog's Swift apps (docs/UPDATES.md):
//   STUDIO_UPDATE_FEED  read this feed instead of SUFeedURL
//   STUDIO_UPDATE_TEST  install an update the moment it is ready
#import <Cocoa/Cocoa.h>
#import <objc/message.h>
#include <node_api.h>
#include <stdlib.h>

@interface EBVUpdaterDelegate : NSObject
@end

@implementation EBVUpdaterDelegate
- (nullable NSString *)feedURLStringForUpdater:(id)updater {
  const char *feed = getenv("STUDIO_UPDATE_FEED");
  return feed ? [NSString stringWithUTF8String:feed] : nil;
}
- (BOOL)updater:(id)updater willInstallUpdateOnQuit:(id)item immediateInstallationBlock:(void (^)(void))install {
  if (!getenv("STUDIO_UPDATE_TEST")) return NO;
  install();
  return YES;
}
@end

static id controller = nil;
static EBVUpdaterDelegate *delegate = nil;

static napi_value Bool(napi_env env, bool v) {
  napi_value out;
  napi_get_boolean(env, v, &out);
  return out;
}

static napi_value Start(napi_env env, napi_callback_info info) {
  if (controller) return Bool(env, true);
  if (![[NSBundle mainBundle] objectForInfoDictionaryKey:@"SUFeedURL"]) return Bool(env, false);
  NSString *path = [[[NSBundle mainBundle] privateFrameworksPath] stringByAppendingPathComponent:@"Sparkle.framework"];
  NSBundle *framework = [NSBundle bundleWithPath:path];
  NSError *error = nil;
  if (!framework || ![framework loadAndReturnError:&error]) {
    NSLog(@"BleepBloop: Sparkle didn't load: %@", error);
    return Bool(env, false);
  }
  Class Controller = NSClassFromString(@"SPUStandardUpdaterController");
  if (!Controller) return Bool(env, false);
  delegate = [EBVUpdaterDelegate new];
  id (*init)(id, SEL, BOOL, id, id) = (id (*)(id, SEL, BOOL, id, id))objc_msgSend;
  controller = init([Controller alloc], NSSelectorFromString(@"initWithStartingUpdater:updaterDelegate:userDriverDelegate:"), YES, delegate, nil);
  if (!controller) return Bool(env, false);
  if (getenv("STUDIO_UPDATE_TEST")) {
    // Release testing: download on its own and check now.
    id updater = ((id (*)(id, SEL))objc_msgSend)(controller, NSSelectorFromString(@"updater"));
    ((void (*)(id, SEL, BOOL))objc_msgSend)(updater, NSSelectorFromString(@"setAutomaticallyDownloadsUpdates:"), YES);
    ((void (*)(id, SEL))objc_msgSend)(updater, NSSelectorFromString(@"checkForUpdatesInBackground"));
  }
  return Bool(env, true);
}

static napi_value Check(napi_env env, napi_callback_info info) {
  if (!controller) return Bool(env, false);
  ((void (*)(id, SEL, id))objc_msgSend)(controller, NSSelectorFromString(@"checkForUpdates:"), nil);
  return Bool(env, true);
}

static napi_value CanCheck(napi_env env, napi_callback_info info) {
  if (!controller) return Bool(env, false);
  id updater = ((id (*)(id, SEL))objc_msgSend)(controller, NSSelectorFromString(@"updater"));
  BOOL can = ((BOOL (*)(id, SEL))objc_msgSend)(updater, NSSelectorFromString(@"canCheckForUpdates"));
  return Bool(env, can);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "check", nullptr, Check, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "canCheck", nullptr, CanCheck, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
