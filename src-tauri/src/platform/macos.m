#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static pid_t returnPID = 0;
static id globalMonitor = nil;
static id localMonitor = nil;
static id workspaceObserver = nil;
typedef void (*GestureCallback)(unsigned short, unsigned long long, bool, unsigned int);
static GestureCallback gestureCallback = NULL;
static id recorderMonitor = nil;
typedef void (*RecorderCallback)(unsigned short, unsigned int, bool);
void ic_restore_focus(void);
#ifdef IDEA_WEBDRIVER
static unsigned long long libraryKeyEvents = 0;
unsigned long long ic_library_key_events(void) { return libraryKeyEvents; }
int ic_frontmost_pid(void) { return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier; }
#endif

static void installLibraryGlass(NSWindow *window) {
    NSView *content = window.contentView;
    NSRect frame = content.bounds;
    NSVisualEffectView *glass = [[NSVisualEffectView alloc] initWithFrame:frame];
    glass.identifier = @"library-glass";
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    glass.material = NSVisualEffectMaterialSidebar;
    glass.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    glass.state = NSVisualEffectStateActive;
    glass.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    glass.wantsLayer = YES;
    glass.layer.cornerRadius = 0;
    glass.layer.masksToBounds = YES;
    [content addSubview:glass positioned:NSWindowBelow relativeTo:nil];
}

typedef void (*FadeCallback)(void *);
static void hideAfterHandoff(NSWindow *window, int remaining, dispatch_block_t completion) {
    if (!window.visible || !NSApp.active) {
        [window orderOut:nil];
        completion();
    } else if (remaining > 0) {
        // Activation is asynchronous. Wait until AppKit has actually processed
        // deactivation before removing its key window.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 16 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            hideAfterHandoff(window, remaining - 1, completion);
        });
    } else {
        // If the destination exits or declines activation, hide the app instead
        // of promoting its library or trapping an invisible capture window.
        [NSApp hide:nil];
        [window orderOut:nil];
        completion();
    }
}
void ic_dismiss_capture(void *pointer, FadeCallback callback, void *context) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    NSRunningApplication *target = [NSRunningApplication runningApplicationWithProcessIdentifier:returnPID];
    BOOL handoff = window.keyWindow && NSApp.active && target && !target.terminated
        && target.processIdentifier != NSProcessInfo.processInfo.processIdentifier;
    dispatch_block_t completion = ^{ callback(context); };
    if (handoff) {
        ic_restore_focus();
        hideAfterHandoff(window, 30, completion);
    } else {
        [window orderOut:nil];
        completion();
    }
}
void ic_fade_capture(void *pointer, bool reducedMotion, FadeCallback callback, void *context) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    // Fade the entire native window. Keep it
    // transparent after hiding so an offscreen reset can never flash on screen.
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *animation) {
        animation.duration = reducedMotion ? .12 : .28;
        [[window animator] setAlphaValue:0];
    } completionHandler:^{
        // Removing the key window while the app is still active makes AppKit
        // bring its library forward. Return activation first, while this
        // transparent window is still key, so the library never flashes.
        ic_dismiss_capture((__bridge void *)window, callback, context);
    }];
}
void ic_reveal_capture(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    window.alphaValue = 1;
}
double ic_capture_alpha(void *pointer) { return ((__bridge NSWindow *)pointer).alphaValue; }
double ic_capture_glass_width(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    for (NSView *view in window.contentView.subviews) {
        if ([view.identifier isEqualToString:@"capture-glass"]) return view.frame.size.width;
    }
    return 0;
}

void ic_record_shortcut(void *pointer, bool enabled, RecorderCallback callback) {
    if (recorderMonitor) { [NSEvent removeMonitor:recorderMonitor]; recorderMonitor = nil; }
    if (!enabled) return;
    NSWindow *window = (__bridge NSWindow *)pointer;
    recorderMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown | NSEventMaskKeyUp | NSEventMaskFlagsChanged handler:^NSEvent *(NSEvent *event) {
        if (event.window != window) return event;
        if (event.type != NSEventTypeKeyUp && (event.type != NSEventTypeKeyDown || !event.ARepeat)) {
            unsigned int flags = ((event.modifierFlags & NSEventModifierFlagControl) ? 1 : 0)
                | ((event.modifierFlags & NSEventModifierFlagOption) ? 2 : 0)
                | ((event.modifierFlags & NSEventModifierFlagShift) ? 4 : 0)
                | ((event.modifierFlags & NSEventModifierFlagCommand) ? 8 : 0);
            callback(event.keyCode, flags, event.type == NSEventTypeKeyDown);
        }
        return nil;
    }];
}

void ic_configure_capture(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    window.level = NSFloatingWindowLevel;
    window.backgroundColor = NSColor.clearColor;
    window.opaque = NO;
    window.hasShadow = NO;
    window.animationBehavior = NSWindowAnimationBehaviorNone;
    // The webview draws opaque paper with a torn edge. No glass sits beneath it.
}
void ic_configure_library(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    window.backgroundColor = NSColor.clearColor;
    window.opaque = NO;
    installLibraryGlass(window);
#ifdef IDEA_WEBDRIVER
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidBecomeKeyNotification object:window queue:nil usingBlock:^(NSNotification *note) {
        (void)note;
        libraryKeyEvents++;
    }];
#endif
}
void ic_position_capture(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    NSPoint cursor = NSEvent.mouseLocation;
    NSScreen *screen = NSScreen.mainScreen;
    for (NSScreen *candidate in NSScreen.screens) if (NSPointInRect(cursor, candidate.frame)) { screen = candidate; break; }
    NSRect visible = screen.visibleFrame;
    NSRect frame = window.frame;
    frame.origin.x = NSMidX(visible) - frame.size.width / 2;
    frame.origin.y = NSMaxY(visible) - MIN(120, visible.size.height * .18) - frame.size.height;
    [window setFrame:frame display:NO];
}
void ic_remember_target(void) { returnPID = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier; }
void ic_activate(void) { [NSApp activateIgnoringOtherApps:YES]; }
void ic_restore_focus(void) {
    if (!NSApp.active || returnPID == 0 || returnPID == NSProcessInfo.processInfo.processIdentifier) return;
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:returnPID];
    if (app && !app.terminated) {
        if (@available(macOS 14.0, *)) {
            [NSApp yieldActivationToApplication:app];
            [NSApp deactivate];
            [app activateFromApplication:NSRunningApplication.currentApplication options:0];
        } else {
            [NSApp deactivate];
            [app activateWithOptions:0];
        }
    }
    returnPID = 0;
}
static void inspectEvent(NSEvent *event) {
    if (!gestureCallback) return;
    unsigned long long milliseconds = (unsigned long long)(event.timestamp * 1000);
    if (event.type == NSEventTypeFlagsChanged) {
        BOOL down = CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, event.keyCode);
        BOOL other = (event.modifierFlags & (NSEventModifierFlagShift | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagFunction)) != 0;
        gestureCallback(event.keyCode, milliseconds, down, other ? 2 : 1);
    } else { gestureCallback(event.keyCode, milliseconds, false, 2); }
}
bool ic_gesture(bool enabled, bool prompt, GestureCallback callback) {
    if (globalMonitor) { [NSEvent removeMonitor:globalMonitor]; globalMonitor = nil; }
    if (localMonitor) { [NSEvent removeMonitor:localMonitor]; localMonitor = nil; }
    if (workspaceObserver) { [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:workspaceObserver]; workspaceObserver = nil; }
    gestureCallback = callback;
    if (!enabled) return true;
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt)};
    if (!AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options)) return false;
    NSEventMask mask = NSEventMaskFlagsChanged | NSEventMaskKeyDown;
    globalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:mask handler:^(NSEvent *event) { inspectEvent(event); }];
    localMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *event) { inspectEvent(event); return event; }];
    workspaceObserver = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { (void)note; if (gestureCallback) gestureCallback(0, 0, false, 2); }];
    return globalMonitor != nil && localMonitor != nil;
}
